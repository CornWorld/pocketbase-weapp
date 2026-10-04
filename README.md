# pocketbase-weapp

PocketBase JS SDK(npm `pocketbase`)的微信小程序适配层。不 fork 官方 SDK——官方包原样引入,本包只接管官方暴露的三个接入点(传输 / 认证持久化 / realtime),外加一个磁盘文件上传助手。

小程序逻辑层没有 `fetch` / `FormData` 等 Web 全局对象,官方 SDK 因此跑不起来:HTTP 请求、`EventSource` 硬编码的 realtime、依赖 `FormData` 的内存文件上传全部失效。本包依赖 [mp-web-polyfill](https://github.com/CornWorld/mp-web-polyfill) 补齐 Web 运行时,并把官方 SDK 的注入点换成小程序实现。除此之外的 API(认证、CRUD、过滤、文件 URL 等)都是官方 SDK 原生行为。

## 安装与前置

```bash
pnpm add pocketbase-weapp pocketbase
```

- peer 依赖:`pocketbase >=0.23 <1`。
- `mp-web-polyfill` 尚未发布 npm,当前以 `link:` 引入同级仓库;使用前请按以下布局克隆:

```text
workspace/
├── mp-web-polyfill/     # git clone https://github.com/CornWorld/mp-web-polyfill
└── pocketbase-weapp/
```

首次 npm 发布后,`link:` 依赖会切换为 registry 版本,届时无需本地克隆。

## 快速开始

```ts
import { createMiniPocketBase, uploadFile } from 'pocketbase-weapp'

const pb = createMiniPocketBase('https://pb.example.com', {
  storageKey: 'pocketbase_auth',      // 可选:wx storage 持久化键
  realtime: { timeout: 10 * 60_000 }, // 可选:realtime 选项,见下文
})

// 认证:官方 SDK API 原样可用,token 自动持久化到 wx storage
await pb.collection('users').authWithPassword('u@example.com', '1234567890')
pb.authStore.isValid // true(基于 JWT 过期时间);冷启动自动恢复登录态

// CRUD
const list = await pb.collection('notes').getList(1, 20)
const record = await pb.collection('notes').create({ title: 'hello' })

// realtime:与官方 subscribe 同签名
const unsub = await pb.realtime.subscribe('notes', (e) => {
  console.log(e.action, e.record) // create / update / delete
})
await unsub()

// 磁盘文件(相机 / 相册 / USER_DATA_PATH):wx.uploadFile 桥
const filePath = `${wx.env.USER_DATA_PATH}/upload.jpg`
await uploadFile(pb, 'notes', 'doc', filePath, { title: '带附件的笔记' })
```

## API 概览

### `createMiniPocketBase(baseUrl: string, options?: CreateMiniPocketBaseOptions): PocketBase`

创建适配客户端:注入 fetch 桥、挂 `WxAuthStore`、替换 `pb.realtime`。返回值就是官方 `PocketBase` 实例,其上一切官方 API 均可用。

`CreateMiniPocketBaseOptions`:

| 字段 | 类型 | 说明 |
|---|---|---|
| `storageKey` | `string` | wx storage 持久化键,默认 `'pocketbase_auth'` |
| `authStore` | `BaseAuthStore` | 自定义 authStore,默认 `WxAuthStore` |
| `realtime` | `RealtimeOptions` | 透传给 realtime 客户端 |

### `WxAuthStore extends BaseAuthStore`

`new WxAuthStore(storageKey?: string)`。构造时从 wx storage 恢复登录态;`save` / `clear` 同步落盘;持久化数据损坏时视为未登录,不抛错。自定义 authStore 可继承官方 `BaseAuthStore`(本包 re-export 该类型)。

### `PBRealtimeClient`

官方 `RealtimeService` 的替代实现。`pb.realtime.subscribe` / `unsubscribe` 已指向它;需要状态或主动断开时经 `getRealtimeClient(pb)` 取回实例。

| 成员 | 说明 |
|---|---|
| `state: RealtimeState` | `'closed' \| 'connecting' \| 'open'` |
| `subscribe(topic: string, handler: RealtimeHandler): Promise<() => Promise<void>>` | 与官方同签名,返回退订函数;同 topic 重复订阅抛错 |
| `unsubscribe(topic: string): Promise<void>` | 退订;订阅清空后主动断开连接 |
| `close(): Promise<void>` | 主动断开,之后 subscribe 抛错 |

`RealtimeMessage`:`{ action: string; record: Record<string, unknown> }`;`RealtimeHandler` 即其回调类型。

`RealtimeOptions`:

| 字段 | 说明 |
|---|---|
| `timeout` | 长连接 `wx.request` 超时(毫秒),默认 10 分钟——wx 默认 60s 会掐断长连接 |
| `reconnectionTime` | 断线重连间隔(毫秒),默认 3000 |
| `onStateChange` | `(state: RealtimeState) => void`,连接状态回调 |

### `getRealtimeClient(pb: PocketBase): PBRealtimeClient | undefined`

取回 `createMiniPocketBase` 内替换进去的 realtime 客户端(读 `state`、主动 `close()`);非本包创建的实例返回 `undefined`。

### `uploadFile(pb, collection, fileField, filePath, body?): Promise<UploadFileResult>`

`wx.uploadFile` 桥:multipart 创建记录并携带文件字段,自动附加 `authStore.token`(已登录时);`body` 中非 string 值 JSON 序列化。返回 `{ response: Record<string, unknown>; statusCode: number }`。仅覆盖「创建记录 + 文件字段」场景,更新已有记录请走官方 API。

### `pocketbase-weapp/realtime`

子路径导出:`PBRealtimeClient`、`RealtimeState`、`RealtimeMessage`、`RealtimeHandler`、`RealtimeOptions`,供不经过 `createMiniPocketBase` 的场景单独使用。

## 工作原理

| 接入点 | 官方机制 | 本包实现 |
|---|---|---|
| HTTP 传输 | `send()` 内 `options.fetch \|\| fetch`,且 `beforeSend` 可整体替换 options | 一处 `pb.beforeSend` 注入 mp-web-polyfill 的 `wx.request` fetch 桥,全局生效 |
| 认证持久化 | 构造器第二个参数传自定义 `BaseAuthStore` | `WxAuthStore` 读写 `wx.setStorageSync` |
| realtime | 官方 `RealtimeService` 硬编码 `new EventSource(...)` 且无注入点 | `PBRealtimeClient` 按 PocketBase realtime 协议自实现,直接替换 `pb.realtime` |

realtime 必须自实现:官方服务直接 `new EventSource(...)`,小程序逻辑层没有 `EventSource`,官方也未留替换点(polyfill 家族的 `EventSource` 装不进去)。`PBRealtimeClient` 用 `wx.request` `enableChunked` 建 SSE 流 + `eventsource-parser` 解析,握手(`PB_CONNECT` 取 clientId → POST 订阅 topic 数组)、推送(`event: <topic>` 携带 `{action, record}`)、断线重连(新 clientId + 全量重放订阅)均与官方 SDK 语义一致。

## 已知边界

- **域名白名单**:生产环境要求 HTTPS + ICP 备案;开发工具 / 体验版勾选「不校验合法域名」可直连 `127.0.0.1`。
- **wx storage 限额**:单 key 1MB / 总量 10MB,且可能被系统回收;authStore 只存一条 JWT + record,正常使用不受影响。
- **体积裁剪**:本包只消费 mp-web-polyfill 的 `/core`、`/fetch`、`/text-encoding` 子路径,默认不含 `./url/idna`(完整 IDNA,~213KB)与 `./streams/full`(完整 Streams,~62KB);非 ASCII 域名等场景需在 App 侧自行 `import 'mp-web-polyfill/url/idna'`。
- **内存文件上传**:官方 SDK 用 `instanceof FormData` 检测,内存 `Blob` / `File` 上传前需安装 polyfill 全局:`installWebRuntimeGlobals({ targets: ['FormData', 'Blob', 'File'] })`(来自 `mp-web-polyfill/installer`);磁盘文件走 `uploadFile()`,无此依赖。
- **兼容性**:针对真实 PocketBase 0.40.4(JS SDK 0.28.1)验证,跟进最新版,不做旧版 API 兼容。

## 开发 / 测试

```bash
pnpm test        # 桥协议单测(wx-mock):认证持久化、fetch 注入、multipart、realtime 握手 / 重连
pnpm test:pb     # scripts/ensure-pb.sh 下载并启动本地 PocketBase,跑真实服务端集成测试
```

集成测试覆盖 health / JWT 认证 / CRUD / 文件上传下载 / realtime 推送;PocketBase 不可达时自动跳过。

## License

MIT
