# 恢复执行入口

先读 `DELIVERY_GOAL.md`（权威目标）与 `PROGRESS.md`。本文件是操作检查点，不替代完整需求。目标仍 active，用户已睡觉并授权自主继续，不需要再等 Go。

## 已有可运行结果

- 官方 fork：`/Users/jerry/code/personal/projects/twenty`，分支 `codex/fanhan-local-rebuild`。不向远端推送，不开 Issue/PR。
- 源码 API `http://127.0.0.1:23001`。UI 23000 尚未启动，不能把 API 登录算页面验收。
- Parser `http://127.0.0.1:23003`，Docker `twenty-recruiting-parser-1`；PG 25432/recruiting、Valkey 26379。
- 旧 `fanhan-local-*` 与 `localhost:13000` 保留；无关 AirJelly/Supabase 容器禁止操作。
- 迁入真实数据：53 公司、166 岗位、925 联系人、497 候选人、1206 附件。另建了 1 家合成公司、1 个合成岗位、1 位合成候选人作验证，应与真实数据分开报告。
- 公司搜索/新建 API 实测通过；GET companies 无鉴权 403。
- 简历上传使用原生 FileUpload target→PUT→complete，再 POST `/recruiting/resume-intakes`。真实 DOCX→2页截图/文字→本机订阅模型结构化→候选人创建→原生 API 回读已通过。
- 重复相同提交得到同一 intake/candidate；解析和模型结果已持久化，后续失败重试不重复调用模型。
- 合成 JD 文字→已选公司→后台整理→AWAITING_CONFIRMATION→确认→岗位创建/原生 API 回读已通过。
- 候选人 fixture：`926eee86-1b7f-5085-82a1-50f164e09124`，简历 intake：`2c631dc4-8e24-53e6-93a5-779e8b6fbdb7`。
- JD fixture：`3aafb953-d524-5ee4-868e-6b246920adf1`，JD intake：`48a9e744-f075-5e6b-a78e-7336a1c97684`。公司 ID 在私有 job-intake-smoke.json。

## 当前进程和私有状态

- API 执行 session 49405，实际 PID 启动日志为 5585；ingestion worker session 94537，日志 PID 6432。恢复时应重新用端口/cwd 核对，不盲用旧 PID。
- Worker 仅启用了 recruiting-queue；曾有仅 workspace-queue 的升级 worker，已停止。旧自动化仍需在后续启用邮件前确认 0 ACTIVE。
- 安装专用 CONNECT→既有 SOCKS 桥接 session 71944，地址 127.0.0.1:11081，Docker 内用 host.docker.internal:11081。不是产品服务；依赖/构建完可停止。不要改全局代理。
- `.local/recruiting/` 被 Git 忽略且含私有数据。environment.json、session.json、原始 dumps、模型、截图、实验和日志都在里面，不打印或提交。
- `ops/recruiting/local-api.mjs` 导出 localRequest、localGraphql、localUpload。只连本地 B，自动使用 `renewToken(appToken)` 刷新私有 session，不能用不存在的 getAuthTokensFromRefreshToken。
- 模型在官方 AI_PROVIDERS 注册 `chatgpt-subscription/gpt-5.6-sol`，当前本机账号目录只有 5.6 系列，不猜 6.1。
- 订阅源只读 `~/.codex/auth.json`（owner-only），原文件已验证不变，不复制/刷新原登录。源码内 Provider 已完成文本、Output.object、图片结构化的真实验证；旧 fanhan-chatgpt-subscription-1 sidecar 已停止。
- SIWC 新账号 OAuth/刷新管理和模型设置 UI 尚未完成；现有本机源可实际推理，不能因此停掉其他业务工作。

## 构建与验证方式

- 固定 Node：`.local/recruiting/runtime/node-v26.12.1-darwin-arm64/bin/node`，已核对官方 SHA-256。PATH 加其 bin。
- `node ops/recruiting/local.mjs build` 直接执行上游 project.json 的编译命令。Nx 本机发现曾无输出等待，勿再用它卡住全部工作。
- 单目标：`node ops/recruiting/build-source.mjs twenty-server build`；可对 twenty-sdk 等显式目标使用。
- 共享包改动后，先完成共享包构建，再跑依赖包 typecheck。不能并行写共享 d.ts 与做全库检查，曾造成上千条假级联错误。
- 原生框架 lint 需要 `@InjectWorkspaceScopedRepository`，ApiKey/File 都已改；provider 用 provideWorkspaceScopedRepository。
- 测试：22 条匹配约束/缓存、6 条 intake 契约、12 条订阅、4 条离线回放、6 条 parser 均已通过。全包 tsgo 曾通过，最新改动后继续复核 checkpoint 日志。
- 日志有过旧 build 进程写同文件造成 NUL；读取用 Python 去掉 `\x00`，新尝试使用新日志名，不能原样 tail 巨量 NUL。

## 导入兼容问题与已用的官方修复

- internal Docker 网络没有发布端口，已仅重建 B 的网络/容器（卷保留），现在 PG/Redis 只绑定 localhost 可访问。
- instance/workspace 升级成功，deferred indexes 已经专用 workspace-queue worker 处理。
- 旧定制富文本缺 Tiptap 列，导致原生 people REST 500。通过官方 `upgrade:2-51:migrate-rich-text-to-tiptap --workspace-id 4cb349cd-5765-4826-a2cb-73e5c5c2d564` 补齐并转换 4769 值，保留原 Markdown/Blocknote；people REST 已恢复 200。不得改旧迁移逻辑或手工覆盖原文。
- 文件属于上传时的字段分区，不能把 intake.files 的同一 fileId 直接塞到 person.candidateResumes。已使用官方 FilesFieldService.copyFileIntoFilesField，并在 intake checkpoint 保存候选人目标文件引用，重试可复用。

## 紧接着需要做的工作

1. 先确认当前 git diff、最新 full typecheck/lint，再把已经通过两条真实链路的入口代码提交为本地行为切片。不要误提交 `.local`。
2. 实现独立匹配队列与服务：人/岗/公司上下文构造、明确约束程序过滤、人岗 1:1 Jev、版本缓存、双向/指定匹配、覆盖/失败/待确认/前五。当前只有 match-policy 和离线 eval，**没有生产匹配任务**；intake 的 matchingStatus=PENDING 还未实际入队，不能称匹配闭环完成。
3. Jev 使用用户已授权的本机 candidate-ranking-algorithm 凭据，按 skill 先 check，不打印/复制 key。`@ai-sdk/gateway` 已声明，createGateway(...).evaluationModel 可用。旧 match-v0.1 能力标准保持基线；改协议要版本化并评测，不能把能力分当最终推荐资格。
4. 将候选人入库、JD 确认及原生记录更新事件接到匹配，不把匹配失败回滚候选人。避免父任务占满 worker 等子任务死锁，材料队列与评分队列要分开限流。
5. 完善批量 JD 每项独立失败/重试与确认幂等；当前 confirmJobs 顺序创建，部分失败后的清晰状态还不完整。长文自动分批/合并尚未实现，当前显式超预算报错。
6. 补简历单请求 multipart 入口和业务 CLI/MCP，现有 JSON fileRefs/native 上传只是已运行的基础。远程 Agent 不能传服务器本地路径。
7. 完成运营工作台实际 UI。尽量官方 Twenty UI/SDK；UI 和 SDK 已从源码构建，renderer 还需其 generate-remote-dom-elements、sandbox:prebuild 和 individual bundles。进度短弹窗，批量导入正常页面，不能沿用旧工作台不规范大组件。
8. 原生 MCP 已存在，按 DefineTool/ToolRegistry 暴露共享业务服务。当前未注册招聘业务工具；原生 CRUD 不等于整个招聘流程已封装。
9. 完成 RS(I) 评测：复用旧 30×46/1380 缓存；22/8 历史分组不是未见测试集，旧 Agent 150 条复核不是人工 gold。新增未见样本、约束违规/前五/排序/耗时费用与分歧报告，再迭代 pipeline。
10. 完成邮件原始 EML/全部信息归档、受控收信接入、来源去重；当前邮箱同步仍关闭，没有新邮件验证。不能重放全部历史。
11. 接问候/发布草稿、人工联系/推荐记录与门户分享确认/撤回。旧数据已导入，但旧应用触发器被停用，**门户与合同等不能宣称已恢复可用**。
12. 模型设置页、现有本机来源状态、官方 Agent 默认选模，以及 SIWC 新账号管理/刷新继续做；订阅不覆盖 Jev 或 Embedding。
13. 整体端到端 UI/API/权限/去重/失败恢复验收，更新需求与数据链路 HTML、启动/回退及验收文档。若个人飞书授权可用，按原用户要求同步个人文档；不发消息、不发布网站。

所有剩余范围仍以 DELIVERY_GOAL 为准。没有实现和证据的条目保持未完成，不能因一夜时间、上下文或预算而缩成只交上述基础链路。
