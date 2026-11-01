# Agent 招聘入口

招聘业务复用 Twenty 原生鉴权、角色、记录与字段权限。外部调用只计一次原生请求限流；后台任务的内部 CRUD 保留权限、审计和存储额度检查，不把每次读写都记为外部 API 请求。授权在执行任务与每批匹配时重新检查，撤销 Key 后不能继续调用。

## 1. HTTP 与原生 MCP

HTTP 基地址为 `/recruiting`，使用当前工作区的 Bearer API Key 或原生会话。文件经 `uploads/targets` → PUT → `uploads/complete` 取得绑定调用者的提交凭据，再提交 `resume-intakes` 或 `job-intakes`。单简历可直接调用 `resume-intakes/upload` multipart，字段为 file、note、source、candidateId、batchId，以 Idempotency-Key 标识提交。

原生 `/mcp` 的 `recruiting_operations` 提供公司搜索/创建、候选人和岗位搜索、上传授权/完成、简历/JD提交、JD确认、队列、进度、重试和三种匹配。默认学习模式先调用 learn_tools；direct 模式直接调用该工具。无需另起 MCP 服务。响应可以是 SSE，客户端应按 MCP 协议读取，不能假定 JSON HTTP 正文。

JD 预览返回稳定 itemId。jobs_confirm 的 items 包含 itemId 与编辑后的 draft，discardedItemIds 表示忽略的预览。部分失败只重试失败项；已创建项不能借确认覆盖人工修改。任务受理后保存 intakeId/runId，后续分页查询或重试。文件上传凭据不进入持久化材料或模型上下文。

## 2. CLI 与 skill

薄客户端为 `ops/recruiting/cli.mjs`，帮助入口为 `node ops/recruiting/cli.mjs --help`。凭据只从 TWENTY_API_KEY 环境变量读取，实例用 TWENTY_BASE_URL 指定；默认指向本地 B。远程要求 HTTPS，不跟随请求重定向。普通结果输出 JSON，业务失败/部分失败使用不同退出码。项目 skill 位于 `.agents/skills/recruiting/SKILL.md`，没有全局安装。

文件从运行 CLI 的 Agent 自己的文件系统上传。恢复时优先用已取得的任务 ID。JD多文件上传在明确传--key时保存跨进程checkpoint，按实例/凭据/提交标识隔离；重跑复用成功文件，提交响应丢失时保持相同文件引用，已存任务ID则向服务器重新鉴权查询。材料或说明改变却复用原key会在上传前拒绝；并发调用用原子不可变slot选择同一文件引用。缓存默认~/.cache/twenty-recruiting，或TWENTY_CLI_STATE_DIR指定，700/600，不存API Key或材料全文，上传能力仍受服务器24小时有效期约束。单简历 multipart 可用原 key 重发，同材料返回原任务，修改材料后复用 key 返回冲突。

## 3. 已验证的本地场景

- 原生 MCP 发现工具，公司查询成功；受限角色 Key 无权读取公司，撤销后 HTTP403。缺失/系统/待激活/跨工作区/角色变化/权限绕过均在工具入口拒绝。
- MCP 完成文件上传、简历提交与入库，随后自动匹配 50 个岗位：46评分、4明确条件排除、0失败，完整覆盖。指定人岗匹配完成，重试复用缓存。
- MCP 完成 JD 提交、预览、确认，创建一个明确标记合成的岗位；重复确认保持同一岗位。
- 连续115次外部查询：99次通过、16次429、无其他错误。未提高或关闭原生外部限额。后台全量匹配在相同限制下正常完成。
- CLI真实公司查询通过，客户端及工具身份/429边界测试通过。草稿、门户与人工跟进的后续接口验收见以下章节；完整前端视觉验收仍未完成。

详细请求与私有结果仅存于被忽略的 `.local/recruiting/`。以上都是本地合成验证，不代表生产验收，也不代表匹配质量评测完成。

## 4. 问候与发布草稿

`POST /recruiting/drafts` 接受 GREETING（candidateId必填，jobId可选）或 JOB_PUBLICATION（jobId必填）、note和idempotencyKey。返回draftId；GET列表/详情、POST retry/review共用同一服务。原生MCP新增draft_submit/draft_edit，并支持kind=draft的task_get/task_retry/queue_list；CLI新增draft greeting/publication/edit。

模型输出先持久化checkpoint，再更新可读文案。写回失败可恢复，复用已保存的完整生成结果；来源职业内容/岗位/公司变化会标过期，核对时再次检查。人工编辑的已核对正文不会被普通retry覆盖。review默认只保存；approve要求直接用户会话，API Key、应用和带Agent委托的身份均不能确认。核对、实际发送、实际发布是独立行为，当前草稿接口没有消息或发布传输能力。

本地已实测两种草稿均由真实订阅模型生成，重复提交同ID，Key核对403，直接会话核对成功，retry保留原文。来源变化、checkpoint恢复、权限丢失及正文完整性有9项测试。页面仍需浏览器验收。

## 5. 门户与跟进

MCP增加portal_create、portal_list、portal_link、portal_revoke、sharing_status，CLI对应portal create/list/link/revoke/status。候选人链接可绑定最多5岗，公司预览仅一个岗位且要求当前有效确认。复制链接需要原创建主体，链接中含限定用途凭据，不能打印到公开报告或发送给未经确认的对象。

MCP activity_note/activity_list和CLI activity note/list共用人工记录服务。Agent只能记录NOTE，不代替人确认已联系/已推荐/已发布。后者仅本人会话可用HTTP/UI操作，公司推荐额外检查候选人分享同意。MCP真实备注success=true且verified=true、门户列表成功、CLI状态与备注成功，API Key实际联系403。界面仍未浏览器验收。

## 6. 合同兼容入口

MCP contract_status/contract_reminder与CLI contract status/reminder --company-id ID共用合同服务。已真实验证两项MCP success=true和CLI状态查询；使用原合成公司及稳定内部任务，不创建新外部合同。资料/签署写入仅当前负责人直接本人会话；Agent不能声明已经签署。详见CONTRACTS.md。

## 7. 入库保存时的权限和并发

明确指定candidateId时必须指向仍有CANDIDATE角色的联系人，不能受理普通联系人后假报入库成功。每次耗时解析/生成返回后的checkpoint及候选人写入前重新解析当前执行身份；撤销或到期会停止，不能沿用旧context写候选人或FAILED。

候选人附件按原生完整版本条件合并，冲突重新读当前附件，保留两个并发提交及原有引用；人工姓名和偏好不被模型修改。服务层真实回归命令为node ops/recruiting/smoke-candidate-cas.mjs，只操作确定合成资料、走原生上传/复制/ORM，禁该测试进程的自动匹配，不调用模型。它不能替代简历理解、页面或业务质量验收。
