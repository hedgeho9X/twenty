# 恢复执行入口

先读 DELIVERY_GOAL.md（权威完整目标）与 PROGRESS.md。用户已睡觉并明确 Go；目标仍 active，无 token budget。不要再 create_goal，也不要把已有基础当完整交付，不需要等用户确认。未经授权不得 push、Issue、PR、部署、生产写入或外发消息。不得 spawn 子 Agent。

## 1. 当前代码和环境

- 唯一开发：/Users/jerry/code/personal/projects/twenty，分支 codex/fanhan-local-rebuild，个人官方 fork hedgeho9X/twenty，官方 base c0ad263b，源码 2.55.0。
- 最新 commits：fc8fd5eb 原生 Gateway；1903099b 职业上下文；cd2db13c Jev pair evaluator；212c834c 双向任务；1335bb24 事件 actor；2b320cc5 自动匹配。先核对 git status/log；目前另有小的快照范围修正未提交。
- B：API localhost:23001，前端 localhost:23000，parser localhost:23003；PG 25432/recruiting，Valkey 26379。A 的 fanhan-local-* 与 localhost:13000 保留，不操作无关 AirJelly/Supabase。
- 真实迁入 53 公司、166 岗位、925 联系人、497 候选人、1206 文件；另有 1 公司、1 岗位、1 候选人 fixture。原业务表摘要/文件抽检已通过，官方升级完成，富文本 Tiptap 列由官方命令补齐。
- 旧工作流 0 ACTIVE、邮箱/日历同步关、旧应用自动触发器关、旧订阅 sidecar 已停止。新 RECRUITING_AUTO_MATCH_ENABLED=true 只处理带明确 actor 的新原生资料事件。
- 当前 API session 24785，PID 9995，日志 api-6.log；worker session 95859，PID 10006，日志 matching-worker-3.log；front session 64242，PID 9062，日志 front-1.log。恢复时用 lsof/cwd 核对，不盲用 PID。
- Worker 启用 recruiting-queue（全局 10）与 recruiting-match-queue（全局 2 runs，每 run 3 pairs）。旧升级 worker 已停止。
- 全部私有数据、环境、Token、日志、实验和模型在被忽略的 .local/recruiting/，禁止打印/提交。完整邮件/自述中的下载 URL 也可能带访问参数，不能再输出原文样本。
- 安装专用 CONNECT→SOCKS bridge 127.0.0.1:11081，session 71944。不是产品服务，构建完可停止，不修改全局代理。

## 2. 已有真实链路

- 公司查询/创建、公司绑定 JD→后台预览→人工确认→岗位创建，已真实通过。
- 原生上传 DOCX→Docling 两页截图/文字→本机 ChatGPT 订阅→Output.object→原生候选人写入/附件复制→原生 REST 回读，已通过；相同提交复用 intake/candidate，重试复用解析和模型 checkpoint。
- fixture 候选人 926eee86-1b7f-5085-82a1-50f164e09124；intake 2c631dc4-8e24-53e6-93a5-779e8b6fbdb7。
- fixture 岗位 3aafb953-d524-5ee4-868e-6b246920adf1；JD intake 48a9e744-f075-5e6b-a78e-7336a1c97684。公司 ID 在私有 job-intake-smoke.json。
- Pair run 529b947e-b739-5483-8a9f-e16f9a6919bc，真实 score 3.18；限定反向 b2a84a8b-4013-5e50-a575-aba2b84fa0c2 同分 cached=true。
- 候选人全量 run 11c98199-eb85-5b50-ab47-6ab28a2a1853：47 岗，43 评分/4 排除/0 失败，前五无明确雇佣类型冲突。版本变更后旧47对曾全部变 stale，不继续显示旧前五。
- 原生 person PATCH 自动触发 2bfe2f0a-4cc5-5961-9669-a93a0049c207：同样47/43/4/0，COMPLETED。
- 原生 job PATCH 自动触发 93166da1-b69e-5e8c-bc8c-3f0f6ee67ec9：498 候选人，421 评分/77 待处理/0 请求失败，PARTIAL，前五仅覆盖成功范围；该轮 cost USD 0.103779186。
- 77 中69没有当前可用结构化职业事实、8超保守预算。69逐项核对的 JSON/说明形状保存在 missing-career-inputs.json：大多 candidateSearchJson=null；有些有职业自述，有些仅下载提示，不能一概说没有材料。
- 新增历史自述 fallback/URL 子串清理/当前人工偏好优先规则，仅源码和测试通过，尚未重建运行。不能把旧421结果称为最新修正后的结果。

## 3. 订阅与 Jev

- 原生 Provider 注册 chatgpt-subscription/gpt-5.6-sol；文本、图片、Output.object 均真实通过。固定只读 ~/.codex/auth.json，不复制或刷新原登录；原文件已确认不变。不是新代理服务。
- 新 SIWC 本人授权、连接存储/刷新/设置页、普通官方 Agent 选模/工具 smoke 尚未完成；当前可用本机来源继续服务其他工作。
- Jev 使用原生 Gateway Provider recruiting-gateway/typesafe-ai/jev，凭据通过官方 /admin-panel addAiProvider 注册。configure-jev.mjs 正确接口是 /admin-panel，addAiProvider 本身是 upsert，没有 updateAiProvider。
- 首次使用 skill 已执行 setup-key.py --check；凭据 ~/.config/candidate-ranking-algorithm/.env，仅服务端读，不打印或复制到仓库。
- 问题保持 match-v0.1 五级能力标准；上下文/eligibility 独立版本，未知不作拒绝。Jev 不生成解释，不能编造理由；intent 和明确约束分开展示。
- 上游默认64k/request、32k/question；本实现以UTF-8 bytes+reserve保守检查，不是精确token计数。长文现在显式待处理，自动分块合并仍要做。

## 4. 工具和构建

- 固定 Node .local/recruiting/runtime/node-v26.12.1-darwin-arm64/bin/node（已核对SHA256），PATH 加其 bin。
- node ops/recruiting/local.mjs build 或 node ops/recruiting/build-source.mjs twenty-server build。Nx 本机发现曾卡住，不要再用其等待阻塞。
- shared改动先完成 shared build，再做其他包 typecheck；不得边写 shared d.ts 边检查依赖包。
- 服务端全包检查：在 packages/twenty-server 运行 ../../node_modules/.bin/tsgo -p tsconfig.json --noEmit；不用 tsconfig.build。
- Jest --config jest.config.mjs --runInBand --watchman=false --runTestsByPath ...；oxlint 已能使用编译好的 twenty-oxlint-rules。
- 最新 auto-match-typecheck-2.log 全包通过；auto-match-lint-1.log 0 warnings/0 errors；auto-match-tests-2.log 15项通过。随后小的poolChanged代码改动，match-snapshot-tests.log 6项通过，需补适当类型检查。
- renderer 已成功构建：twenty-ui build:individual、twenty-shared build:individual、renderer generate-remote-dom-elements、sandbox:prebuild、build。twenty-sdk 没有 build:individual，不能再调用该目标；SDK本身已 build。
- local-api.mjs 导出 localRequest、localGraphql、localUpload，只连 B，私有 session 自动 renewToken。localRequest 返回 Response，必须 response.json()；不要直接 JSON.stringify(Response)。
- localUpload 目前用原生 createFileUpload→PUT→complete；前端现已启动，上传URL可经23000代理，脚本仅本地可改23001且保留签名，不打印URL。

## 5. 浏览器与 UI 接续

- ego-browser skill 已完整读，专用 TaskSpace 14，p1 已实际登录 localhost:23000，当前原生公司表54条。只能复用此 space，不另建、不接管其他用户空间，不用旧space10的授权页。不要 finish 正在进行的任务。
- 新运营 UI 目前完全未写，旧数据库导入的“运营工作台”页面不是本次交付。旧自定义手动动作尚需禁用/替换，避免以后点到旧执行链。
- 新UI建议路径 /recruiting-workspace；不能用 /recruiting，它是API代理前缀。
- 尽量官方 Twenty组件：PageHeader、PageContainer、Button（children/startIcon/loading）、Input/Textarea（onValueChange）、Field.Root/Label/Description、Tabs.Root/List/Tab/Indicator/Panel、Dialog.Root/Portal/Backdrop/Viewport/Popup/Header/Title/Description/Body/Footer。
- 当前组件在 twenty-ui/primitives/input、navigation、surfaces、feedback、data-display 导出；样例在各组件 __stories__。业务样式使用 Linaria + themeCssVariables，不引入shadcn等第二套组件库。
- UI fetch 使用官方 SESSION_COOKIE_OPT_IN_HEADER_NAME + credentials:include、~/config 的 REACT_APP_SERVER_BASE_URL（默认同源）；当前官方已经是 cookie auth，不再找旧 tokensPairState。
- 原生 metadata hook 是 useObjectMetadataItem({objectNameSingular:'recruitingIntake'})，不是 useObjectMetadataItemByNameSingular。
- 路由接 createWorkspaceRouteObjects.tsx；导航可用原生 NavigationDrawerItem。后续通过元数据API隐藏新增内部表导航，替换旧工作台链接。
- 具体操作：公司搜索/就地创建→JD文件/文字+说明→可逐行编辑确认的正常页面；候选人批量文件+说明→队列短弹窗→原生记录链接；匹配待查看/双向和指定匹配→详情并列材料/公司/条件/评分；再加跟进/草稿/门户。

## 6. 紧接着的工作

1. 先检查未提交的 snapshot/poolChanged 修正。修正内容：读取旧匹配时不再显示已移出候选人角色的联系人；全池人数改变要标 poolChanged，不冒充当前全量覆盖；新目标需发起新run，retry保留原快照范围。测试已过，提交前补类型/lint。
2. 重建并只重启本仓库 API/worker，使 URL 清理、职业自述fallback生效。对既有全量反向 run重试，复用仍有效cache，另存最新证据；不能把下载提示当职业事实，也不能把historical意向当当前硬限制。
3. 优先把统一上传和真实运营UI做出来。需要补业务上传包装/单文件multipart端点与CLI；已有JSON fileRefs不能算完整统一上传API。
4. 文件授权边界要核实并补齐：当前 parser.file 只校验workspace/status/static/size；原生 FileEntity 没有上传者字段，只有path分区/settings/contentSha256。不要认为拿到fileId就自动有字段/记录权限。可用薄业务上传target+complete包装原生 FileUploadService，并签发绑定workspace/principal/fileId的提交凭据；既有引用必须绑定当前可读intake/来源记录。不要新造完整Vault。Native FileUploadModule导出 FileUploadService；createFileUpload与completeFileUpload真实签名已查。
5. 再验证一次真实intake的事件/回调自动匹配幂等、失败不影响已入库状态。继续完善批量JD逐项失败/独立重试、确认幂等、人工修改不被覆盖；现在confirmJobs仍按index顺序创建，部分失败管理不完整。
6. 完成长文分块/合并与中文扫描、损坏/加密文件等必要格式回归，全部页图覆盖不丢页。当前8个超限旧候选人不能冒充已经评分。
7. 补官方 MCP DefineTool/ToolRegistry 业务动作与薄 CLI/skill：公司/JD、简历、进度、双向/指定匹配、结果、草稿与人工跟进。认证/权限/重复提交要实测。尚未注册招聘 MCP工具。
8. 独立评测/RS(I)：已有实验30×46/1380缓存是回顾资料，22/8不是未见测试集；新增未见候选人、盲审silver标签、硬约束/输入保真/前五/排序/覆盖/耗时费用报告。不是用户确认gold，不无限调优。
9. 完整邮件 EML/原文/正文/全部附件与内嵌资源归档、来源事件去重，受控收信接统一入口；当前同步仍关闭，没有新实收验收。
10. 问候/JD发布草稿、人工联系/推荐记录、门户资料/附件/意向/分享确认与撤回、合同必要兼容。旧数据已导入，旧触发器关，不能称门户已恢复。
11. 继续内置订阅管理：设置页面、官方Agent默认选模与tools验证、SIWC新账号PKCE/OIDC/刷新/加密连接。缺本人授权如实记录，现有只读本机来源仍可用。
12. 整体UI/API/权限/重试/去重验收、更新数据链路HTML、启动/回退/验收文档；个人飞书授权若可用，按原用户要求同步个人文档，不发消息、不发布网站。

完整目标以 DELIVERY_GOAL 为准，不能缩成只交已实现的API或把未验收项勾选完成。
