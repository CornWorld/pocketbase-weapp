# cornworld-miniprogram-pb-sdk

PocketBase JS SDK 的**微信小程序适配层**。不 fork 官方 SDK——`pocketbase`(npm)原样引入,
本包只做官方 SDK 暴露的三个接入点 + 一个文件上传助手:

| 接入点 | 官方机制 | 本包实现 |
|---|---|---|
| HTTP 传输 | `send()` 内 `options.fetch \|\| fetch`,且 `beforeSend` 可整体替换 options | `injectFetchBridge`:一处 `pb.beforeSend` 注入 `mp-web-polyfill`(wx.request 桥),全局生效 |
| 认证持久化 | 构造器第二个参数传自定义 `BaseAuthStore` | `WxAuthStore`:读写 `wx.setStorageSync`,JWT 损坏容错 |
| realtime | 官方 `RealtimeService` **硬编码 `EventSource` 且无注入点** | `PBRealtimeClient`:wx.request `enableChunked` SSE + `eventsource-parser` + 重握手重订阅,`subscribe/unsubscribe` 与官方同签名,直接替换 `pb.realtime` |
| 磁盘文件 | SDK 仅支持内存 FormData/Blob | `uploadFile()`:`wx.uploadFile` 桥(创建记录 + 文件字段) |

## 用法

```ts
import { createMiniPocketBase, uploadFile, getRealtimeClient } from '@cornworld/mp-pocketbase'

const pb = createMiniPocketBase('https://pb.example.com', {
  storageKey: 'pocketbase_auth',        // 可选
  realtime: { timeout: 10 * 60_000 },   // 可选:长连接超时与重连间隔
})

// —— 之后就是原版 SDK API ——
await pb.collection('users').authWithPassword(id, password)
const list = await pb.collection('notes').getList(1, 20)

const unsub = await pb.realtime.subscribe('notes', (e) => {
  console.log(e.action, e.record) // create / update / delete
})
await unsub()

// 磁盘文件(相机/相册/USER_DATA_PATH)
await uploadFile(pb, 'notes', 'doc', filePath, { title: '带附件的笔记' })

// 内存文件(相机外的二进制):先安装全局 FormData/Blob,再走原版 create
// installWebRuntimeGlobals({ targets: ['FormData', 'Blob', 'File'] })
await pb.collection('notes').create(formData)
```

## 关键协议事实(对真实 PocketBase **0.40.4** 验证;跟进最新版,不做旧 API 兼容;JS SDK(npm `pocketbase` 0.28.1)已为最新)

- realtime 握手:GET `/api/realtime`(SSE)→ `event: PB_CONNECT` 取 `clientId` →
  POST `/api/realtime` `{clientId, subscriptions: ['topic', …]}`(**0.24+ 为纯 topic 字符串数组**);
- 服务端以 `event: <topic>` 推送 `{action, record}`;
- 断线重连 = 全新 clientId,必须全量重放订阅;订阅清空时主动断开(与官方 SDK 一致);
- `authStore.isValid` 基于 JWT 过期校验(`isTokenExpired`),依赖服务端签发的真 JWT;
- SSE 线格式含 `id:` 帧、无空格字段名,`eventsource-parser` 按规范处理。

## 前提与边界

- 依赖 `mp-web-polyfill` 单包(当前以 `link:` 指向同级 `cornworld-miniprogram-polyfill`
  仓库,首次 npm 发布后切换为 registry 版本);
  本包只消费 `/fetch`、`/core`、`/text-encoding` 子路径,**不引入** `./url/idna`(tr46 ~213KB)
  与 `./streams/full`(web-streams ~62KB)两个按需重依赖 —— 中文域名等场景由 App 侧自行安装;
- **内存文件上传**需要全局 `FormData/Blob/File` 为 polyfill 实现(官方 SDK 用 `instanceof` 检测):
  `installWebRuntimeGlobals({ targets: ['FormData', 'Blob', 'File'] })`;磁盘文件走 `uploadFile()`,无此依赖;
- wx storage 语义(单 key 1MB / 总 10MB / 可能被系统回收)由 polyfill 包显式文档化;
- 域名白名单:HTTPS + ICP 备案(生产硬门槛);开发工具/体验版勾选「不校验合法域名」可直连 127.0.0.1。

## 测试(与 polyfill 仓库同一边界哲学)

- **B 层桥协议**(`test/pb.test.ts`):`@cornworld/wx-mock` 上验证 auth 持久化、beforeSend 注入、
  multipart 序列化、realtime 握手/推送/断线重连/空订阅断开;
- **真实服务端集成**(`test/pb-integration.test.ts`):`bash scripts/ensure-pb.sh` 下载并播种
  PocketBase 0.28.1,对**真实服务端**跑 health / JWT 认证 / CRUD / 文件上传下载 / realtime 推送;
  PB 不可达时自动跳过。

```bash
pnpm test        # B 层单测
pnpm test:pb     # 下载/启动/播种 PocketBase + 跑集成
```

## 发布

changesets + npm provenance + GitHub artifacts,与 polyfill 仓库同流程(见其 README「发布」)。
