# pocketbase-weapp

PocketBase JS SDK(npm `pocketbase`)的微信小程序适配层。

官方包原样引入,不做 fork。本包只接管官方暴露的三个接入点(HTTP 传输、认证持久化、realtime),另提供一个磁盘文件上传助手。其余 API 均为官方 SDK 原生行为。

小程序逻辑层没有 `fetch`、`FormData` 等 Web 全局对象,官方 SDK 无法直接运行。[mp-web-polyfill](https://github.com/CornWorld/mp-web-polyfill) 负责补齐 Web 运行时。

## 安装

```bash
pnpm add pocketbase pocketbase-weapp
```

peer 依赖 `pocketbase >=0.23 <1`。

`mp-web-polyfill` 尚未发布 npm,当前以 `link:` 指向同级仓库。使用前按以下布局克隆:

```text
workspace/
├── mp-web-polyfill/
└── pocketbase-weapp/
```

## 快速开始

```ts
import { createMiniPocketBase, uploadFile } from 'pocketbase-weapp'

const pb = createMiniPocketBase('https://pb.example.com')

// 认证与 CRUD 为官方 API,token 自动持久化到 wx storage
await pb.collection('users').authWithPassword('u@example.com', '1234567890')
const list = await pb.collection('notes').getList(1, 20)

// realtime 与官方 subscribe 同签名
const unsub = await pb.realtime.subscribe('notes', (e) => {
  console.log(e.action, e.record)
})
await unsub()

// 磁盘文件。filePath 来自相机、相册或 USER_DATA_PATH
await uploadFile(pb, 'notes', 'doc', filePath, { title: '带附件的笔记' })
```

## API

### createMiniPocketBase(baseUrl, options?)

返回官方 `PocketBase` 实例,已注入 fetch 桥、`WxAuthStore` 和 `PBRealtimeClient`。

`CreateMiniPocketBaseOptions`:

| 字段 | 说明 |
|---|---|
| `storageKey?: string` | wx storage 持久化键,默认 `pocketbase_auth` |
| `authStore?: BaseAuthStore` | 自定义 authStore,默认 `WxAuthStore` |
| `realtime?: RealtimeOptions` | realtime 客户端选项 |

### WxAuthStore

`BaseAuthStore` 实现,读写 `wx.setStorageSync`。构造时恢复登录态,`save` 与 `clear` 同步落盘,持久化数据损坏时视为未登录。

### PBRealtimeClient

官方 `RealtimeService` 的替代实现,`pb.realtime` 已指向它。经 `getRealtimeClient(pb)` 取回实例。

| 成员 | 说明 |
|---|---|
| `state` | `closed` / `connecting` / `open` |
| `subscribe(topic, handler)` | 与官方同签名,返回退订函数。重复订阅同一 topic 抛错 |
| `unsubscribe(topic)` | 退订。订阅清空后断开连接 |
| `close()` | 主动断开,之后 subscribe 抛错 |

`RealtimeOptions`:

| 字段 | 说明 |
|---|---|
| `timeout` | `wx.request` 超时(毫秒),默认 10 分钟。微信默认 60 秒会断开长连接 |
| `reconnectionTime` | 重连间隔(毫秒),默认 3000 |
| `onStateChange` | 连接状态回调 |

### getRealtimeClient(pb)

返回 `PBRealtimeClient` 实例。非本包创建的实例返回 `undefined`。

### uploadFile(pb, collection, fileField, filePath, body?)

经 `wx.uploadFile` 创建记录并写入文件字段。自动附加 token,`body` 中非字符串值做 JSON 序列化,返回 `{ response, statusCode }`。仅覆盖创建场景,更新记录走官方 API。

### pocketbase-weapp/realtime

单独导出 `PBRealtimeClient` 与 realtime 类型,用于不经过 `createMiniPocketBase` 的场景。

## 工作原理

| 接入点 | 官方机制 | 本包实现 |
|---|---|---|
| HTTP 传输 | `send()` 中 `options.fetch \|\| fetch`,`beforeSend` 可整体替换 options | `pb.beforeSend` 注入 polyfill 的 `wx.request` fetch 桥 |
| 认证持久化 | 构造参数传入自定义 `BaseAuthStore` | `WxAuthStore` 读写 wx storage |
| realtime | 官方硬编码 `new EventSource`,无替换点 | `wx.request` `enableChunked` 建 SSE 流,`eventsource-parser` 解析 |

realtime 的握手、推送、断线重连语义与官方 SDK 一致。重连后使用新 clientId 并全量重放订阅,订阅清空时主动断开。

## 边界

- 域名白名单:生产要求 HTTPS 与 ICP 备案。开发工具勾选「不校验合法域名」可直连 `127.0.0.1`。
- wx storage:单 key 1MB,总量 10MB,可能被系统回收。authStore 只存一条 JWT 与用户记录,正常使用不受影响。
- 体积:只消费 polyfill 的 `/core`、`/fetch`、`/text-encoding`,不含 `url/idna`(约 213KB)与 `streams/full`(约 62KB)。需要时在应用侧自行引入。
- 内存文件上传:官方 SDK 以 `instanceof` 检测 `FormData`。上传内存 `Blob` 或 `File` 前需执行 `installWebRuntimeGlobals({ targets: ['FormData', 'Blob', 'File'] })`(来自 `mp-web-polyfill/installer`)。磁盘文件用 `uploadFile`,无此要求。
- 兼容性:针对 PocketBase 0.40.4 与 JS SDK 0.28.1 验证。跟进最新版,不兼容旧版 API。

## 开发

```bash
pnpm test        # 桥协议单测(wx-mock)
pnpm test:pb     # 启动本地 PocketBase,跑真实服务端集成测试
```

集成测试覆盖 health、JWT 认证、CRUD、文件上传下载、realtime 推送。PocketBase 不可达时自动跳过。

## License

MIT
