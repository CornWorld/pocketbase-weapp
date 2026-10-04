# pocketbase-weapp

PocketBase JS SDK(`pocketbase`)微信小程序适配层。

- 官方包原样引入,非 fork
- 接管官方三个接入点:HTTP 传输、认证持久化、realtime
- 磁盘文件上传助手 `uploadFile`
- 其余 API 为官方 SDK 原生行为
- 小程序逻辑层无 `fetch` / `FormData` 等全局对象,Web 运行时由 [mp-web-polyfill](https://github.com/CornWorld/mp-web-polyfill) 补齐

## 安装

```bash
pnpm add pocketbase pocketbase-weapp
```

- peer:`pocketbase >=0.23 <1`
- `mp-web-polyfill` 未发 npm,以 `link:` 指向同级仓库,按以下布局克隆:

```text
workspace/
├── mp-web-polyfill/
└── pocketbase-weapp/
```

## 快速开始

```ts
import { createMiniPocketBase, uploadFile } from 'pocketbase-weapp'

const pb = createMiniPocketBase('https://pb.example.com')

await pb.collection('users').authWithPassword('u@example.com', '1234567890')
await pb.collection('notes').getList(1, 20)

const unsub = await pb.realtime.subscribe('notes', (e) => {
  console.log(e.action, e.record)
})
await unsub()

// filePath: 相机 / 相册 / USER_DATA_PATH
await uploadFile(pb, 'notes', 'doc', filePath, { title: '带附件的笔记' })
```

## API

### createMiniPocketBase(baseUrl, options?)

返回官方 `PocketBase` 实例。注入 fetch 桥与 `WxAuthStore`,替换 `pb.realtime`。

| `CreateMiniPocketBaseOptions` 字段 | 说明 |
|---|---|
| `storageKey?: string` | wx storage 键,默认 `pocketbase_auth` |
| `authStore?: BaseAuthStore` | 默认 `WxAuthStore` |
| `realtime?: RealtimeOptions` | 见下表 |

### WxAuthStore

`BaseAuthStore` 的 wx storage 实现。构造时恢复登录态,`save` / `clear` 同步落盘,数据损坏视为未登录。

### PBRealtimeClient

官方 `RealtimeService` 替代实现,`pb.realtime` 已指向。`getRealtimeClient(pb)` 取回实例。

| 成员 | 说明 |
|---|---|
| `state` | `closed` / `connecting` / `open` |
| `subscribe(topic, handler)` | 同官方签名,返回退订函数。重复订阅同一 topic 抛错 |
| `unsubscribe(topic)` | 订阅清空后断开连接 |
| `close()` | 主动断开,之后 subscribe 抛错 |

`RealtimeOptions`:

| 字段 | 说明 |
|---|---|
| `timeout` | `wx.request` 超时(毫秒),默认 10 分钟。微信默认 60 秒断开长连接 |
| `reconnectionTime` | 重连间隔(毫秒),默认 3000 |
| `onStateChange` | 连接状态回调 |

### getRealtimeClient(pb)

返回 `PBRealtimeClient`。非本包创建的实例返回 `undefined`。

### uploadFile(pb, collection, fileField, filePath, body?)

`wx.uploadFile` 创建记录并写入文件字段。自动附加 token,非字符串值 JSON 序列化,返回 `{ response, statusCode }`。仅创建,更新走官方 API。

### pocketbase-weapp/realtime

单独导出 `PBRealtimeClient` 与 realtime 类型。

## 工作原理

| 接入点 | 官方机制 | 本包实现 |
|---|---|---|
| HTTP 传输 | `send()` 内 `options.fetch \|\| fetch`,`beforeSend` 可整体替换 options | `pb.beforeSend` 注入 `wx.request` fetch 桥 |
| 认证持久化 | 构造参数传自定义 `BaseAuthStore` | `WxAuthStore` 读写 wx storage |
| realtime | 官方硬编码 `new EventSource`,无替换点 | `wx.request` `enableChunked` SSE,`eventsource-parser` 解析 |

握手、推送、重连语义同官方:重连换新 clientId、全量重放订阅、订阅清空即断开。

## 边界

| 场景 | 限制 |
|---|---|
| 域名白名单 | 生产需 HTTPS + ICP 备案。开发工具勾选「不校验合法域名」可连 `127.0.0.1` |
| wx storage | 单 key 1MB,总量 10MB,可能被系统回收。authStore 仅存一条 JWT 与用户记录 |
| 体积 | 仅 `/core` `/fetch` `/text-encoding`,不含 `url/idna`(约 213KB)与 `streams/full`(约 62KB),需要时应用侧自行引入 |
| 内存文件上传 | 官方 SDK 以 `instanceof` 检测 `FormData`。上传内存 `Blob` / `File` 前需 `installWebRuntimeGlobals({ targets: ['FormData', 'Blob', 'File'] })`(来自 `mp-web-polyfill/installer`)。磁盘文件无此要求 |
| 兼容性 | PocketBase 0.40.4、JS SDK 0.28.1 验证。跟进最新版,不兼容旧版 API |

## 开发

```bash
pnpm test        # 桥协议单测(wx-mock)
pnpm test:pb     # 本地 PocketBase 集成测试
```

覆盖 health、JWT 认证、CRUD、文件上传下载、realtime 推送。PocketBase 不可达时自动跳过。

## License

LGPL-3.0-only。全文见 [LICENSE](./LICENSE)。
