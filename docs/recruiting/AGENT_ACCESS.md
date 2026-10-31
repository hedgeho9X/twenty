# Agent 招聘入口

招聘业务复用 Twenty 原生鉴权、角色、记录与字段权限。外部调用只计一次原生请求限流；后台任务的内部 CRUD 保留权限、审计和存储额度检查，不把每次读写都记为外部 API 请求。授权在执行任务与每批匹配时重新检查，撤销 Key 后不能继续调用。

## 1. HTTP 与原生 MCP

HTTP 基地址为 `/recruiting`，使用当前工作区的 Bearer API Key 或原生会话。文件经 `uploads/targets` → PUT → `uploads/complete` 取得绑定调用者的提交凭据，再提交 `resume-intakes` 或 `job-intakes`。单简历可直接调用 `resume-intakes/upload` multipart，字段为 file、note、source、candidateId、batchId，以 Idempotency-Key 标识提交。

原生 `/mcp` 的 `recruiting_operations` 提供公司搜索/创建、候选人和岗位搜索、上传授权/完成、简历/JD提交、JD确认、队列、进度、重试和三种匹配。默认学习模式先调用 learn_tools；direct 模式直接调用该工具。无需另起 MCP 服务。响应可以是 SSE，客户端应按 MCP 协议读取，不能假定 JSON HTTP 正文。

JD 预览返回稳定 itemId。jobs_confirm 的 items 包含 itemId 与编辑后的 draft，discardedItemIds 表示忽略的预览。部分失败只重试失败项；已创建项不能借确认覆盖人工修改。任务受理后保存 intakeId/runId，后续分页查询或重试。文件上传凭据不进入持久化材料或模型上下文。

## 2. CLI 与 skill

薄客户端为 `ops/recruiting/cli.mjs`，帮助入口为 `node ops/recruiting/cli.mjs --help`。凭据只从 TWENTY_API_KEY 环境变量读取，实例用 TWENTY_BASE_URL 指定；默认指向本地 B。远程要求 HTTPS，不跟随请求重定向。普通结果输出 JSON，业务失败/部分失败使用不同退出码。项目 skill 位于 `.agents/skills/recruiting/SKILL.md`，没有全局安装。

文件从运行 CLI 的 Agent 自己的文件系统上传。恢复时优先用已取得的任务 ID，避免重新上传相同 JD 文件产生新的上传引用；跨进程文件上传 checkpoint 尚待补齐。单简历 multipart 可用原 key 重发，同材料返回原任务，修改材料后复用 key 返回冲突。

## 3. 已验证的本地场景

- 原生 MCP 发现工具，公司查询成功；受限角色 Key 无权读取公司，撤销后 HTTP403。缺失/系统/待激活/跨工作区/角色变化/权限绕过均在工具入口拒绝。
- MCP 完成文件上传、简历提交与入库，随后自动匹配 50 个岗位：46评分、4明确条件排除、0失败，完整覆盖。指定人岗匹配完成，重试复用缓存。
- MCP 完成 JD 提交、预览、确认，创建一个明确标记合成的岗位；重复确认保持同一岗位。
- 连续115次外部查询：99次通过、16次429、无其他错误。未提高或关闭原生外部限额。后台全量匹配在相同限制下正常完成。
- CLI真实公司查询通过，5项客户端测试通过；工具身份与429边界8项测试通过。完整前端视觉验收及草稿/人工跟进入口仍未完成。

详细请求与私有结果仅存于被忽略的 `.local/recruiting/`。以上都是本地合成验证，不代表生产验收，也不代表匹配质量评测完成。
