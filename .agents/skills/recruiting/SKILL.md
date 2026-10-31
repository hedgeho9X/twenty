---
name: recruiting
description: 操作本项目的招聘业务：公司与JD录入、候选人材料上传、异步处理及双向人岗匹配。使用业务API、原生MCP或项目CLI，不用于修改底层工作流或直接联系候选人。
---

# 招聘运营

在项目根目录使用 `node ops/recruiting/cli.mjs --help`。默认本地 B 环境为 `http://localhost:23001`，凭据仅从 `TWENTY_API_KEY` 环境变量读取；其他实例必须明确设置 `TWENTY_BASE_URL`。不要在命令参数或聊天里放凭据。

原生 MCP 已连接时，先学习 `recruiting_operations`，使用其中的 typed operation。它和 CLI 共用业务服务。文件不能用服务器本地路径：CLI 从自己的文件系统上传；MCP 使用 upload_target → 客户端 PUT 字节 → upload_complete → resume_submit/jobs_submit。

## 公司与岗位

- 先 `companies search --query 名称`，确认公司身份；无对应记录再 `companies create --name 名称`，不按相似名称自动合并。
- `jobs submit --company-id ID --text-file JD.txt --note-file 说明.txt --key 唯一标识 --wait`。可重复 `--file`，一批只绑定一家公司。
- AWAITING_CONFIRMATION 表示待确认预览。通过 `task get --kind intake --id ID` 获取稳定 itemId、完整 draft 和缺失提示，再准备 items JSON，执行 `jobs confirm --id ID --items-file 路径`。
- 修改、删除、重排必须保留 itemId。只重试失败项；已有岗位不能靠再次确认覆盖人工修改。忽略预览不会删除已创建岗位。

## 候选人与匹配

- `resume upload --file 简历.pdf --note-file 自述.txt --key 唯一标识 --wait`。支持图片、PDF、Word、TXT、HTML、Markdown；每次一个文件对应一个候选人。多页图片/补充附件属于同一人的场景可用 MCP/HTTP files 数组。需要补充已有记录时显式传 `--candidate-id`，不能按姓名猜目标。
- 同一请求重试复用 key；材料或说明改变则使用新 key。202仅表示持久化并排队。NEEDS_REVIEW/FAILED 要核对阶段与错误；`task retry` 使用已成功checkpoint，不重新拼造任务JSON。
- `match candidate --id 候选人ID --wait`、`match job --id 岗位ID --wait` 或 `match pair --candidate-id ID --job-id ID --wait`。`--targets` 可明确限定本批范围。
- 分数是0–4能力匹配，最多展示前五。检查 complete、counts、stale、poolChanged；部分成功不能冒充全库排名，未知条件不等于明确不符合，失败不是零分。

## 恢复与边界

- `mail import --file 完整邮件.eml --wait` 归档完整原文与全部MIME资源；`task get --kind mail --id ID`查看artifactKeys。`mail select --id ID --items-file 选择.json --wait`按artifactKeys、可选candidateId和note交给统一候选人入库。MCP先用上传授权/完成取得文件凭据，再mail_import；mail_select选择材料。NEEDS_SELECTION是待选择，不是入库完成。内嵌图保留，默认不当简历；正文自动作为补充。父邮件权限与上传凭据仍必须满足，不能用其他记录的fileId。原生邮箱连接与自动收取以当前设置和真实验收为准，EML导入不是实收。

- `draft greeting --candidate-id ID --job-id ID --note-file 说明.txt --key 唯一标识 --wait` 生成问候，岗位可省略；`draft publication --job-id ID --key 唯一标识 --wait` 生成岗位发布稿。用 `task get --kind draft --id ID`、`queue list --kind draft` 查询，`draft edit --id ID --items-file 文案.json` 保存 title/body。原生MCP对应draft_submit/draft_edit。API Key只能生成与编辑；直接用户会话可核对草稿，核对不代表已发送或发布。来源变更时需重新生成，重试不会覆盖已核对的人工正文。

- 保留 intakeId/runId 继续 `task get` 或 `queue list`。队列丢失或失败可通过 `task retry`，不得直接编辑内部 result/payload；内部状态和评分缓存有完整性校验。
- 原始文件、说明与邮件来源应完整保留。下载提示不等于已取得简历，不能声称模型理解了未获得的附件。
- 匹配、问候、发布文案属于辅助结果。实际联系、推荐、发送、发布及候选人分享同意由相应的人确认；本技能不提供自动对外行动授权。
- 更详细的本地启动、数据边界和验收状态见 `docs/recruiting/DELIVERY_GOAL.md`、`PROGRESS.md` 与 `NEXT_ACTIONS.md`。使用部署实例时以其当前API返回为准，不把本地合成样例当生产验收。
