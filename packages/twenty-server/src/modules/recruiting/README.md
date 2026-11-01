# 招聘领域服务

根目录的 `recruiting.module.ts` 是 Nest 注册入口。业务文件按职责归组；这次目录分层不增加新的 Nest 容器边界，已有 Provider、队列任务名、路由和持久化协议保持稳定。

| 目录 | 职责 |
| --- | --- |
| `api/` | 工作台 HTTP Controller 和原生 Agent 工具入口 |
| `auth/` | actor 重新授权、工具权限、上传权限和请求限流 |
| `intake/` | 材料任务、候选人入库、岗位保存及输入 schema；`domain/` 保存材料分段规则 |
| `files/` | Twenty 文件上传、受权原件读取、解析器 HTTP 适配；`domain/` 保存上传凭据协议 |
| `mail/` | IMAP 接收、完整 MIME 归档、归属副本和邮件队列；`domain/` 保存邮件拆分与文件槽位规则 |
| `ai/` | 通过原生模型注册完成候选人/JD 的结构化提取 |
| `matching/` | 双向匹配调度、单对 Jev 评估、资料变更监听；`domain/` 保存上下文、约束和评分协议 |
| `drafts/` | 问候/发布草稿生成及后台任务 |
| `portal/` | 候选人门户、资料确认、分享授权和公司预览；`domain/` 保存门户 schema 与访问规则 |
| `activities/` | 人工联系、推荐等跟进记录 |
| `records/` | 官方 RecordCrud 数据访问和公司/候选人/岗位目录查询；`domain/` 保存记录完整性规则 |
| `shared/locking/` | 各业务共用的 PostgreSQL advisory lock 注册、连接池和注入标识 |

主要链路：

- 运营页面或 Agent → `api` → `intake` → `files` 解析 → `ai` 提取 → `records` 入库 → `matching` 独立排队。
- IMAP → `mail` 完整归档 → 同一 `intake`，不建立第二套简历提取流程。
- `matching` 调度 → 单对 evaluator → 明确约束和 Jev → 版本化缓存 → 排序结果。
- `portal` 与 `activities` 管理资料确认和人工业务回执，不负责自动发送或联系。

各业务可以调用基础能力 `auth`、`records`、`shared/locking`；纯规则在业务自己的 `domain/`，不依赖 Controller。测试与实现放在同一业务目录。保留现有服务类名和任务名，避免目录调整意外改变 Nest 注入、外部调用或 Redis 中已持久化任务的身份。

文档解析进程位于 `ops/recruiting/parser/`；ChatGPT 订阅适配位于 `src/engine/core-modules/chatgpt-subscription/`，后者继续通过官方模型 Provider 接入。
