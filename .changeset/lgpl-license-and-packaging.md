---
'pocketbase-weapp': major
---

**Breaking change:**license 从 MIT 变更为 LGPL-3.0-only。0.1.x 以 MIT 条款分发,升级前请确认 LGPL-3.0 的合规义务(尤其是作为库被打包内联进小程序 Application / Combined Work 时的告示与文档随附要求)对你是否可接受。

同时修复打包:发布 tarball 的 `files` 此前只含 `dist`,LGPL-3.0-only 的 `license` 字段却没有随包 LICENSE 文本;现在 `LICENSE` 一并随包发布,并在 LICENSE 中补上本项目版权声明(`Copyright (c) 2026 CornWorld`)。
