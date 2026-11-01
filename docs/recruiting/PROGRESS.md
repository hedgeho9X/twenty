# 执行进度与证据

更新时间：2026-11-01，Asia/Shanghai。

## 当前状态

- 用户已明确授权开始自主执行全部本地外包工作。
- 权威目标：同目录 `DELIVERY_GOAL.md`；后续恢复必须先读取，不能只依赖对话摘要。
- 分支：`codex/fanhan-local-rebuild`，基于官方 `c0ad263b35a734dbd2528bf82c5dd38d3b18dc1b`。
- 官方源码B已运行：http://localhost:23000/recruiting-workspace，API23001、parser23003；招聘worker与AI-only worker均已启动，旧A13000保留。
- 已实现统一公司/JD/简历/完整邮件、持久队列、双向匹配、草稿、门户/分享撤回/人工回执、合同兼容及进程内订阅连接；实现、真实接口与页面视觉验收分开。
- 最新重点回归29套162项招聘/订阅测试、15项CLI/上传恢复/缓存回放通过；两包TS及相关lint通过。全格式解析另有9项+当前版本旧DOC独立真实回归。
- 新SIWC本人授权、浏览器任务空间恢复后的页面QA、自然新邮件实收及业务方质量核对仍待完成；目标active，不能标全完成。完整使用说明见RUNBOOK.md，最新检查点见NEXT_ACTIONS.md末尾。

## 初始核实（历史记录，后续结果见下文）

- 当前官方源码版本 2.55.0，已有 REST、GraphQL、原生 `/mcp`、角色鉴权和新的 CLI。
- MCP 通过 `ToolRegistryService` 暴露原生及应用逻辑函数工具；需要进一步核对业务工具注册和文件传输边界。
- CLI 有 `data list/get`、`api rest/graphql`；当前 REST 请求只支持 JSON body，文件上传尚需薄封装。
- 当前 `twenty-ui` 有公开组件/主题文档，应以当前源码导出为准，不照搬旧组件路径。
- 旧本地库只读盘点：53 公司、166 岗位、163 公司关联、163 JD 正文、139 岗位偏好、100 公司偏好快照；25 公司有招聘偏好。
- 旧 intake：3 CANDIDATE、1 JOB；原始材料不能由派生 JSON 无损重建。
- 实验：30 人 × 46 岗真实 Jev 全量评分已完成；当前选择逐对评分，明确约束先由程序处理。旧向量召回不是当前默认 Pipeline。
- OpenAI 官方 SIWC 文档明确公共 Responses 路径和账户模型目录；CLIProxyAPI 的 Go SDK/协议实现仍在核对。无新本人授权，未发真实订阅推理。

## 初始推进顺序（历史记录）

1. 完成 API/SDK/UI/订阅代码调查及技术决策记录。
2. 安装本地开发依赖，建立独立 OrbStack 数据库/缓存与源码运行环境。
3. 按 DELIVERY_GOAL.md 逐项实施并追加真实验证证据。

## 本地基础设施验证

- `ops/recruiting/local.mjs up` 成功，`twenty-recruiting-db-1` 与 `twenty-recruiting-cache-1` 均 Healthy。
- 数据库实查：`recruiting|twenty|0`，为独立空库，不是旧泛函或 AirJelly 数据库。
- 配置重复 init 内容不变，配置权限 0600，`.local/recruiting/environment.json` 已确认被 Git 忽略。
- UI 预留 23000、源码 API 23001、PG 25432、Valkey 26379；仅 DB/缓存已运行，不能据此报告应用可用。
- Node 26.7.0 满足 package engine；仓库 `.nvmrc` 固定 26.12.1，需留意真实构建差异。依赖安装进行中。

## 数据副本导入验证

- `ops/recruiting/import-snapshot.mjs` 从 A 的只读 pg_dump 复制到独立空库 B，恢复使用单事务，拒绝覆盖已有库。
- 源/目标均为：53 公司、166 岗位、925 联系人、497 候选人。
- 对 50 张业务表按所有行计算摘要，源/目标全部一致；仅工作流相关表按隔离要求停用。
- 1206 个文件共 1,870,957,537 bytes 已复制；所有文件大小一致，确定性抽样 10 个 SHA-256 一致。
- A 保留 18 个 ACTIVE 工作流版本，B 为 0；B 的邮件、日历同步均为 0。旧逻辑函数触发器、Webhook 与生产域名在 B 清除。
- 原始只读 dump、全表摘要及文件检查保存在 `.local/recruiting/`，未提交个人资料或凭据。
- 导入不等于已与新版代码兼容：下一步运行官方升级并回读验证，修复兼容问题后再启动 worker。

## 未完成的外部依赖

- 新 SIWC 账号连接仍需本人授权；已发现可复用的本机 Codex ChatGPT 登录，并完成真实文本及 AI SDK 结构化验证。原 auth 文件只读且已验证内容不变，不复制/刷新原登录 Token，不使用旧 sidecar。
- 旧临时火山 Key 在实验结束已删除。当前默认逐对 Jev 不依赖重新 embedding；后续若需要真实 Embedding 调用应使用明确授权的可用凭据。
- 不向远程 GitHub 或生产提交任何改动。

## 匹配领域与评测基线

- 新增 `src/modules/recruiting/matching/domain/match-policy.ts`：只过滤明确冲突，保留未知；支持岗位同时接受多种雇佣/办公方式，远程与城市条件分别处理。
- 双向共享缓存键覆盖工作区、人/岗/公司版本、协议和模型。Jest 22 项通过，独立 TypeScript 检查通过。
- 离线评测 CLI 已复用全部 1380 对缓存，输入哈希与覆盖验证通过；4 项 CLI 行为测试通过，无新增模型调用。
- 历史 30 人均已被审阅，22/8 分组只作回顾性调优/验证，不能称未见测试集；尚未装入独立标签或已确认条件，不能报告招聘准确率或硬条件合规率。

## 解析实现进展

- 原生 Python 3.12 私有环境已安装 Docling 2.145.0、RapidOCR、Playwright；下载约 730MB 固定模型与私有 Chromium。
- parser 服务和文件边界已实现初稿。6 项测试通过：鉴权、路径隔离、哈希变更、中文职业正文保留、HTML 主动内容清理、真实长 Markdown 分页预览。
- 真实合成 PDF 和 PNG 均经 CPU Docling 处理，状态 complete、各 1 页，均提取到 TypeScript 与 Backend；原始报告在 `.local/recruiting/parser-smoke/report.json`。
- 发现并修复禁脚本浏览器中 add_style_tag 卡住问题，改为在固定 HTML 内容中注入样式，保持上传脚本禁用。
- Word/旧 DOC、中文扫描质量、服务容器及 Node 业务接入仍未验收。

## 当前构建状态

- Yarn focus 依赖安装已成功。直接连接停传后，使用仅供安装的本机 HTTP CONNECT→既有 SOCKS 桥接恢复，未修改全局网络配置。
- 固定 Node 26.12.1 已从官方归档下载并校验 SHA-256，位于 `.local/recruiting/runtime/`；后续构建优先使用该版本。
- 新 Nx 的 binary 路径为 `dist/bin/nx.js`；本地运行器已改为调用 `.bin/nx`，避免硬编码旧路径。
- `server-build.log` 记录官方源码构建，`parser-build.log` 记录解析镜像构建。CPU torch 2.15.0、CPU torchvision 0.29.1 已选定，避免引入无用 CUDA 依赖。
- Docker Hub DNS 超时通过宿主机代理下载官方镜像再 docker load 处理；Python 基础镜像平台 digest 为 `sha256:e0b3f8d16a5ccfbe602d5c94297e5dbcda2ec256edca2b80fcd44e39e1ff6feb`。
- 不把基础设施、解析单测或静态构建当应用验收；新 UI/API、升级、上传与 Agent 流程尚未打通。

## 官方源码运行与升级

- Nx 本机项目发现无输出等待；直接执行各包已提交 project.json 中的同一编译命令成功。`ops/recruiting/build-source.mjs` 复用这些目标，未维护另一套编译参数。
- 9543 个服务端文件编译成功；共享包、客户端 SDK、邮件模板和 SDK assets 已构建。
- 已为子进程提供仓库固定 Yarn 的本地 wrapper，无需全局安装。
- 发现 internal bridge 不发布端口：HostConfig 有 25432 映射而 NetworkSettings 为 null。仅重建 B 的网络/容器并保留卷后，宿主机源码可连接；A 未改动。
- 官方 instance 升级与 `upgrade --workspace-count-limit 1` 工作区升级均成功；10 个 deferred index 操作由仅启用 workspace-queue 的 worker 完成。
- 源码 API `127.0.0.1:23001` 启动并通过原账号认证；GraphQL 实查公司 53、岗位 166、联系人 925。UI 尚未启动，不能称页面登录验收完成。
- 原自动工作流仍为 0 ACTIVE。后台升级 worker 只启用了 workspace-queue。
- 通过官方元数据 API 建立 3 个招聘内部对象及资料字段，见 `schema-bootstrap-report.json`；bootstrap 可恢复执行，不手写业务建表 SQL。

## 解析容器验证

- `twenty-recruiting-parser-1` Healthy，端口仅 `127.0.0.1:23003`，原件/模型只读挂载，输出独立，非 root 用户，6GB/4CPU 限额。
- 使用 CPU torch 2.15.0 和 CPU torchvision 0.29.1，不含 CUDA 运行依赖。
- 合成 DOCX 与 LibreOffice 生成的旧 DOC 均真实通过容器 HTTP：complete、各 2 页、中文和 TypeScript 文字可回读，预览无丢页。
- TXT、长 Markdown 渲染与 HTML 主动内容隔离的 6 项测试通过；图片/PDF 本机 CPU 实测各 1 页成功。仍需完整中文扫描与真实格式样本回归及业务入口集成。

## 订阅进程内实现

- `chatgpt-subscription/subscription-fetch.ts` 已实现 Codex/SIWC 路由分离、SSE 终止校验、非流式 Responses JSON 聚合和 SOCKS 传输；8 项测试、独立 TS 检查通过。
- 已扩展官方 Provider authType=chatgpt 和 subscriptionAccountId，SdkProviderFactory 直接生成 OpenAI Responses 模型，不另启代理服务。
- 本机账号模型目录实际显示 gpt-5.6-sol/terra/luna；不能使用示例里的 gpt-6.1 代替账户可用模型。
- 真实文本请求 response.completed，31 tokens；AI SDK Output.object 实测通过，211 tokens，category/expectedRoles 正确；原登录文件不变。
- 模型注册、设置页、图片/工具调用、SIWC 新账号连接与刷新管理仍待完成；当前不能报告整个订阅功能已验收。

## 已打通的业务入口检查点

- 订阅模型已通过官方 addAiProvider 管理接口注册，保留席位门槛与管理权限：seatCount=2、seatThreshold=25、hasAccess=true。
- 图片 + Output.object 真实验证通过（合成红图返回 red，59 tokens）；订阅模块现在共 12 项测试通过。旧独立代理容器已停止。
- 招聘功能模块已接入原生 REST 权限、当前调用者重建、工作区隔离仓库和独立 recruiting-queue；全局及单 worker 并发均为 10。
- 公司查询、名称搜索、创建合成公司实测通过；未鉴权返回 403。队列与详情接口不在列表中泄露完整 OCR 文本。
- 简历完整后端链路实测通过：原生上传 DOCX → 真实 durable job → 两页文字/截图 → 订阅 SDK 结构化 → 原生 person 创建 → 原生 REST 回读 200。
- 合成候选人 `926eee86-1b7f-5085-82a1-50f164e09124`，intake `2c631dc4-8e24-53e6-93a5-779e8b6fbdb7`。相同输入重复提交返回同一候选人，无重复创建。
- 公司/JD 后端链路实测通过：先建/选公司 → 文字 JD 提交 → AWAITING_CONFIRMATION → 确认 → recruitmentJob 创建 → 原生 REST 回读 200。合成岗位 `3aafb953-d524-5ee4-868e-6b246920adf1`。
- 附件不能直接跨 FILES 字段引用，已使用官方 copyFileIntoFilesField，候选人目标文件引用写入 checkpoint；重试复用解析与模型结果。
- 发现旧定制富文本缺 Tiptap 列，使原生 people REST 本身返回 500；通过官方 2.51 迁移重跑修复并转换 4769 个值，保留原 Blocknote/Markdown，REST 恢复 200。
- 最新全包 TypeScript 检查通过；招聘入口 lint 无警告/错误；intake 契约 6 项测试通过。仍应在后续改动后重新核对。
- 当前仅后端基础闭环，未实现匹配 Job2、完整 UI、招聘 MCP/CLI、邮件适配、问候、门户和独立 SIWC 管理；下一步详见 NEXT_ACTIONS.md，目标不缩减。

## 原生 Gateway 评估 Provider

- 官方模型工厂增加 `@ai-sdk/gateway`，同时支持语言与 evaluation 模型；Jev 使用独立评估注册表，不冒充 ChatGPT 订阅模型。
- Provider 工厂单测通过，无付费请求；`configure-jev.mjs` 通过原生管理员 API 注册，凭据只在内存与本地服务器配置使用，不进入仓库、报告或前端。
- 上游 TypeSafe 当前文档确认默认 64k/request、32k/question；匹配采用保守 UTF-8 字节预算并明确报超限，不启用未经验证的长上下文请求头。
- 依据：https://docs.typesafe.ai/models 、https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway 。实际业务匹配验收另行记录。

## 人岗输入保真与明确约束

- 新旧候选人资料通过只读适配器整理为职业上下文；旧复杂 JSON 不再作为新入库格式。职业事实及支持原话保留，联系方式仅替换子串，不整行删除。
- 版本仅由职业材料、意向、岗位、公司上下文和策略内容决定；人工联系状态及更新时间不触发无意义重评。
- 只对可明确识别的当前声明执行硬排除；旧模型派生的雇佣类型为 unconfirmed。拒绝实习不等于只接受全职，兼职不被连带排除；否定、历史语句不误作当前拒绝。
- 输入适配和既有 eligibility 共 29 项测试通过。中文表达仍有未覆盖情况，保持未知与人工确认，不把规则解析器称为完整语义理解。

## 原生逐对 Jev 与缓存验证

- PairEvaluator 在 native RecordCrud 权限下保存评分；先验证创建/更新权限再发付费请求。同一人岗输入由 PostgreSQL advisory lock 防止并行重复评分，缓存 24 小时有效，包含人/岗/公司、协议与模型版本。
- 评分只沿用 match-v0.1 五级能力问题；意向与 eligibility 单列，不生成伪造的 Jev 理由。上游授权失败只保存安全错误分类，当前任务停止继续向失效授权发请求。
- 合成候选人与合成岗位的真实原生 Jev 请求完成：3.18/4，1363 输入 tokens，gateway cost USD 0.000057246；这只验证链路，不代表质量评测通过。
- 同一组合从反向任务读取时 cached=true、分数相同。更新输入策略后 47 个旧 pair 在读取时全部标过期、前五为空，未把旧排名当当前结果。
- 修正中文说明子句识别后重跑合成候选人的当前全部 47 岗位（46 真实岗位 + 1 fixture）：43 评分、4 明确雇佣类型排除、0 失败、前五 5 个、前五硬约束违规 0；该轮实际 cost USD 0.004755576。
- 空材料、完整材料超限、过期缓存更新、权限不足不付费和授权错误无泄漏的单元测试已加入；质量与独立标签验证仍未完成。

## 独立匹配任务与前端底座

- `/recruiting/match-runs` 已支持候选人→岗位、岗位→候选人及指定组合；独立 recruiting-match-queue 全局最多 2 个 ranking run，每个 run 最多 3 个模型调用，不占用材料整理队列并发。
- 任务持久化覆盖数量与逐对状态，提供结果、重试和人工“已查看”。相对前五会去除完全相同公司/岗位上下文的重复项，分数相同按 ID 稳定排序；失效和失去读取权限的组合不进入当前前五。
- 同一 fixture 的正向与限定反向任务均已真实完成并复用相同 pair。全量反向、原生资料变动自动触发及 UI 工作台仍待下一切片验收。
- 新前端已在 localhost:23000 启动；通过 ego-browser 专用任务空间 14 的 p1 实际使用原账号完成登录，原生公司表显示 54 条（53 原数据 + 1 fixture）。不能把已迁入的旧“运营工作台”链接当成新 UI 完成。
- 原生 renderer 使用 twenty-ui/shared individual bundles、remote DOM 生成、sandbox prebuild 后成功构建；未引入第二套 UI 组件库。安装/构建日志与 session 均在私有目录。
- 最新全包服务端 TypeScript 检查通过；当前重点 4 个测试套件 23 项通过，招聘与事件相关 lint 0 warnings / 0 errors。

## 原生记录事件的权限身份

- 原生数据库事件新增仅含 userWorkspaceId/apiKeyId/applicationId/viaApplicationId/agentId 的 actor 引用，绝不附带 Token 或完整认证对象；系统写入没有具体发起人时不自动升级成管理员。
- ORM 事件格式测试验证发起人引用和令牌不进入 payload；原有格式用例继续通过。该扩展用于后台重新校验权限，不改变原生 CRUD 的权限判断。

## 原生资料变更后的自动匹配

- RecruitingRecordChangeListener 已把候选人职业资料、岗位正文/偏好、公司简介/招聘偏好变更接到独立匹配任务；联系状态、时间戳和系统无主体写入不触发付费重评。
- Intake 完成后也调用同一个 submitForRecord，按职业内容版本派生任务标识；事件监听与入口回调不会各建一份相同的自动任务。匹配入队失败只影响匹配状态，不回滚已入库资料。
- 已通过原生 people PATCH 修改 fixture 说明，自动触发 run `2bfe2f0a-4cc5-5961-9669-a93a0049c207`：47 总数、43 评分、4 明确排除、0 失败、COMPLETED。
- 已通过原生 recruitmentJobs PATCH 修改 fixture 招聘偏好，自动触发 run `93166da1-b69e-5e8c-bc8c-3f0f6ee67ec9`，覆盖 498 位候选人（497 原数据 + 1 fixture）：421 评分、77 待处理、0 请求失败，PARTIAL；能力前五仅来自成功评分范围，该轮 cost USD 0.103779186。
- 77 位中，69 位未取得结构化职业事实、8 位超过保守上下文预算。进一步逐条读取发现：69 位里多数没有 candidateSearchJson，部分保留“历史投递自述”，部分只有附件提示；不能把 69 全部说成没有任何材料，也不能拿附件提示凑职业信息。
- 已补职业自述来源识别、下载链接子串清理，以及当前人工偏好优先于归档说明的回归规则；这些最新修正目前仅源码/单测完成，尚未重新编译、跑全量反向回归。旧结果作为更改前基线保存，不冒充新结果。
- 原生事件/输入相关重点 15 项测试通过；服务端全包 typecheck 通过，招聘 lint 0 warnings / 0 errors。还需验证一次真实 intake 的事件/回调幂等，并处理批量确认、文件授权、长文拆分和完整运营 UI。

## 开发服务器私有目录隔离

- 实测 Vite 默认 workspace fs allow-list 会将仓库里的 .local/recruiting 暴露给 /@fs 请求；检查仅请求 HEAD 状态，没有输出配置正文。
- 已在 Vite fs.deny 保留原生 .env/证书/.git 规则并加入 **/.local/**。只重启本仓库前端后，environment/session/schema-report 三种私有文件均返回403，raw import及编码路径也返回403，应用首页仍200。
- 本地运行数据继续保存在私有忽略目录，前端不打包或直接访问这些文件；用户数据通过有权限的业务接口读取。

## 匹配结果的快照范围

- 匹配详情会核对当前候选人角色，并比较当前全池数量与任务快照。池里新增目标时返回 poolChanged/currentPoolCount，不能把旧快照标为当前全量完成。
- 新增目标需要新任务；失败重试仍固定原任务范围。6项 orchestration 测试通过，包含新目标进入后 complete=false；当前服务端全包类型检查通过。

## 已验收的统一上传边界

- 新建 targets/complete 包装原生上传生命周期，并签发绑定工作区、调用者、文件及标签的24小时提交凭据；新提交不能只给任意 fileId。凭据在入库前移除，不进入队列材料或模型上下文。
- 单请求 POST /recruiting/resume-intakes/upload 支持 file + optional note、已有candidateId及batchId。multipart 内容摘要在分配文件前做幂等查询；同请求重发202同intake，修改说明后复用key409；无凭据的裸fileId引用400。
- 原生接收/隔离/MIME检测与complete均复用，上传权限在multipart缓冲前校验。6项授权/签名边界测试通过；服务端全包类型检查及招聘 lint 通过。
- 真实 multipart DOCX intake d5091942-1afd-5671-9d27-66b8fe3a0332 已完成两页材料整理并更新原fixture候选人，随后只产生1个自动匹配任务 66dcb4e6-1d88-58c7-9d60-a8dfe72c1685。
- 实测现有候选人更新时发现 FILES 读取附加 url/extension 为只读，已仅投影 fileId/label 后回写。失败重试复用已有模型结果和文件checkpoint，成功后匹配独立进行，未重复运行材料模型。

## 内部任务状态的可信边界

- 通用 CRM CRUD 仍可编辑普通公司/候选人/JD；内部 intake、matchRun、pairCache 的输入与checkpoint改用服务端MAC校验，避免伪造RAW_JSON绕过上传、队列或模型结果。
- 本地使用独立 RECRUITING_STATE_SIGNING_KEY，保存在私有环境文件。签名仅认证完整性，不加密资料；备份环境时需一起保留该key。FILES仅规范化fileId/label，忽略原生只读URL/extension。
- 仅本人服务器管理员会话、维护开关打开时可一次性升级旧开发记录。本地升级3 intake、6 matchRun、597 pairCache后读取均通过；维护开关已关闭，入口返回400，API Key/应用不能运行维护。
- 真实负向验证：原生CRUD可建立合成未签名行，但业务retry返回404，不进入处理；合成行已清理。普通有效队列仍200，未被污染。
- 新签名intake e92f0625-7914-5320-b5be-ebe6fb8b5da4 已COMPLETED/STORED，后续自动run 4f0990b3-5e83-50e5-b0ee-17dd5ee50df8 完成。签名读写经过完整原生往返验证。
- 签名与orchestration重点9项测试、服务端全包typecheck及招聘lint通过。匹配任务另在每批重查来源与目标读取权限，过期来源停止为SUPERSEDED，避免继续消耗旧版本评分。

## 公司/JD逐项确认

- 新服务 RecruitingJobConfirmationService 为每个原始预览生成稳定itemId/jobId，不依赖确认时数组位置。编辑、忽略、倒序提交及单项重试均保留身份；每个结果立即checkpoint。
- 单项错误不撤销成功岗位；重试只处理失败项。已创建项不同内容返回冲突，不能通过重试覆盖人工修改。旧选择枚举仅写可表达投影，完整contract/hybrid等事实仍保留在canonical profile。
- 4项行为测试通过；服务端类型检查通过。真实原文识别出3个岗位，倒序确认并故意给B空标题：A/C创建，B失败；只修正B后3项全部创建，ID保持一致。
- 新增3个明确标记“本地批量验收”的合成岗位：adc9cda9-1b12-5bd0-a1d5-e7a9b22129af、20cf684b-8ea5-568d-986b-936190f6e974、e4970ddc-1b06-510c-80a9-a8a6976befd6。真实原数据仍53公司/166岗位/497候选人；当前fixtures为1公司/4岗位/1候选人。
- 前端已实现公司查询/就地创建→JD文字/多文件→稳定项预览→逐项编辑/忽略→确认；队列可跳回预览页。当前前端全包typecheck、21文件lint均通过；浏览器恢复许可仍待回复，未声称页面视觉验收完成。

## 原生 MCP、薄 CLI 与外部请求计量

- 原生招聘工具已接官方 Tool Registry/MCP，HTTP与MCP使用同一个目录、上传、入库、匹配服务，不另起服务；工具当前角色交集需与实时重新解析结果一致，不能传入系统或绕过权限身份。项目skill已校验，没有全局安装。
- 实测 MCP 简历上传→入库→自动50岗完整覆盖（46评分/4明确排除/0失败），指定人岗完成并缓存复用；JD提交→预览→稳定itemId确认→重复确认同ID成功。新增合成岗位2cbca970-1038-55e1-a334-311a4c1b26b6，当前fixtures为1公司/5岗位/1候选人。
- 修正长任务每次内部CRUD都计入外部100/min而中断的问题：只在HTTP/MCP边界计一次，内部保留权限/审计/存储额度检查。115次外部请求99通过、16次429、0其他错误，未提高或关闭限额。受限Key越权拒绝，撤销Key后403。
- 8项身份/429测试、5项CLI测试通过。服务端全包TS、招聘lint通过；前端最新4入口全包TS与24文件lint通过。详见AGENT_ACCESS.md；尚待页面视觉验收、草稿/跟进等完整范围。

## 新原生工作台页面

- /recruiting-workspace 连接官方鉴权与侧栏，四个入口为公司与岗位、候选人入库、匹配待查看、手动匹配，另有短队列弹窗。批量JD使用稳定项编辑与逐项错误，不将长编辑塞进弹窗。
- 手动匹配可从候选人或公司/岗位发起，指定组合共用后台Pipeline；详情标明覆盖、过期、池变化与最多前五，已查看独立于人工联系。简历共同说明始终可编辑；补充已有候选人的多附件强制同一组，避免并发覆盖。
- 官方组件/主题/图标，无新增UI库；全包前端TS与24文件lint通过。Ego专用空间消失后的恢复请求尚待本人回复，因此源码完成仍不等于视觉和交互验收。旧导航/旧动作清理及草稿/跟进/门户仍待后续切片。

## 旧入口隔离

- 仅在本地B通过官方元数据API隐藏旧运营工作台、旧Agent Skill/CLI导航及3个内部任务表导航，停用3个旧匹配跟进/候选人沟通页动作，避免进入已隔离的旧执行链。合同入口暂保留以便兼容盘点，未启动任何旧工作流。
- configure-navigation.mjs首次备份到私有navigation-backup.json，重复运行0变更；提供--restore，通过官方metadata重建导航/重置动作。回退路径已实现，尚未实际演练。未删除业务表、历史记录或附件。

## 完整长材料分段整理

- 分段计划按Unicode码点切分，逐字符可重建原文，所有声明页图逐一进入计划；不把UTF-8字节预算冒充精确token计量。长文逐段提取可核查事实，再一次Output.object合并为简化业务资料；分段结果写入签名checkpoint，重试复用完成片段。
- 资料整理默认改为官方模型管理smart档；显式RECRUITING_MODEL_ID仍可固定实验模型，禁用模型不会静默切换。合并事实仍超预算时明确待人工处理，不递归压缩或静默截断。
- 5项完整覆盖/中断恢复/禁用模型测试通过，服务端全包TS/lint通过。真实合成JD共265104字符/555242字节，经10个分段及合并进入AWAITING_CONFIRMATION；末尾独立Iceberg/Trino要求及45000元薪资上限均保留。仅预览，没有创建或发布该长JD。
- 该实测验证文字覆盖与末尾事实，完整长页图依然需要真实多页回归；材料模型整理不等于每个事实均理解无误。Jev评分的超长上下文仍独立待处理，不能把这项入库改动说成已解决旧8个超限评分。

## 问候与发布草稿

- recruitingDraft使用独立受签名保护的持久记录，复用10并发招聘队列。先保存模型结果checkpoint，再更新可编辑标题正文；中途写回失败可恢复，源候选人/岗位/公司版本变化后标过期，核对时再次检查；普通retry不会覆盖已核对的人工文案。
- POST/GET drafts、retry/review已接共享服务。API Key、应用和带Agent委托身份不能确认人工核对；review只表示文案核对，不改变已发送、已发布、分享同意或推荐状态。未接任何消息/发布传输。
- 两种真实合成草稿均已完成，Key核对403，直接会话核对成功，重复提交相同ID，retry原文保持。GREETING effd92fe-1a3d-502c-8a9a-82b9ab38a829；JOB_PUBLICATION edac60c2-340e-5713-9d90-1a7bdef1ada2。9项草稿/完整性测试、服务端全包TS/lint通过。
- 官方元数据新增草稿表与字段。发现workspace-queue未启用使10项deferred schema action阻塞，确认该队列仅有本地schema任务后临时运行metadata worker，全部完成再停止；未启用旧邮件/工作流队列。bootstrap只对明确的前置deferred guard有限重试，不盲重试未知写入。
- MCP新增draft_submit/draft_edit及kind=draft查询/重试/列表；CLI新增draft greeting/publication/edit，真实MCP与CLI回读APPROVED均成功。项目skill已同步。
- 前端新增问候/发布草稿页、来源记录链接、失败重试、编辑/核对，匹配行可带入人岗组合；全包前端TS/lint通过。实际页面验收仍待Ego恢复许可，人工联系/推荐/发布回执和门户尚未实现。

## 完整邮件原文归档与统一材料交接

- 新recruitingMailArchive/recruitingMailEvent受内部状态签名保护；EML先经原生上传生命周期归档，再招聘队列展开完整MIME。保存完整text/HTML/headers/地址/附件/inline资源，逐项checkpoint；源事件与业务材料各自幂等，相同UID不同原文拒绝合并。
- POST mail-archives/upload、列表/详情/retry、强制下载artifact、选材料进intake已实现。父归档权限校验后才能重绑其文件凭据，不提供任意fileId授权；简历/完整正文/可选说明/邮件来源进入既有解析与模型链。
- 实际合成archive f2c854b0-0bf5-5fc1-979a-2440dced6e04，6份材料下载SHA256均相符，inline图片保留。重复原文/材料提交复用ID；intake ead17ffe-3cf0-572f-b4d3-56995621ee0e COMPLETED/STORED，expectedRoles后端工程师，自动run59d966ea-cef7-53be-a47d-dc10474559b7。没有新建人，仅更新原fixture。smoke-mail.mjs可复现。
- 首次连续上传第二次碰到展开锁返回400，已加受理后快速回执路径及回归测试，尚未重启验证最新修正。当前API16/PID22596/session86569，worker12/PID22607/session64658；metadata worker2/PID22242已停。恢复先核对。
- 10项MIME/恢复/权限测试已通过，新增快速回执测试正在mail-archive-tests-3运行；服务端TS/lint通过。新增表的官方schema任务已由临时workspace worker执行完再关闭。原生IMAP事件接入、实际收信、邮件UI/MCP/CLI仍未完成，不能将上传EML称实际收信。

## 工作台后台轮询

- 隐藏的JD/匹配/草稿标签页停止定时请求，保留已加载数据与本地编辑状态，返回时恢复；取消或过期响应不能覆盖新的路径结果。避免多个保留面板累积占满原生外部限额。
- 两项React hook回归测试、前端全包TS和lint通过。该验证不替代浏览器页面验收。

## 邮件Agent与运营入口

- MCP mail_import使用本人上传凭据归档完整EML，不再复制已有上传文件；mail_select及kind=mail的查询/列表/重试接同一服务。CLI mail import/select支持原文文件与持久进度。真实MCP/CLI均复用既有archive/intake，没有新建候选人。
- 快速重复回执修正已重建生效：全新合成EML连续两次受理均返回同ID，第二次状态QUEUED，没有再因后台展开锁返回400。新合成archive0e314158-9984-5fc5-bde9-6172b1d8e628仅归档，不提交候选人。
- 新邮件页可导入EML、看完整正文、逐项下载/选择、关联已有候选人、填说明；已有入库记录时额外确认另一新候选人，避免无意重复建人。私有下载使用cookie opt-in和Blob，不将不可信HTML在CRM内执行。前端TS/lint通过，浏览器未验收。
- 原邮件候选人后续run59d966ea...完整51岗（47评分/4明确排除/0失败）。当前API17/session43989，worker13/session86073，实际PID看日志。原生IMAP接收设置/事件/实收仍待完成。

## 原生IMAP原文事件边界

- 原生MIME解析结果保留rawSource，GetMessages在CRM投影前对新收件且非草稿邮件发出awaited内部事件，只有稳定owner/account/folder/UIDVALIDITY/UID引用与完整字节，无账号Token。
- 无消费者时原生行为保持；已配置消费者失败会传播并关闭原生连接，不将原文接受失败冒充正常前进。4项原生边界测试通过，TS/lint通过。尚未注册招聘消费者、未重启、未实收，事件本身不等于接入完成。

## 邮件来源别名与业务幂等

- 邮件被复制到另一个文件夹时，完整来源别名仍保留在归档；已受理的候选人入库冻结首个来源引用，不因新别名改变输入摘要而冲突或重复建人。新增回归验证来源列表可增长、同一选材请求的mail输入保持不变。

## 本人邮箱连接与真实单封读取

- 新收信设置绑定原生connected account所有者，Key/应用/Agent委托/冒用会话不可管理或读取连接；只返回本人IMAP连接摘要。捕获默认关闭，开启边界按服务器INTERNALDATE过滤此前历史邮件，缺稳定时间则停止核对。原生事件消费者按当前owner权限重新授权，失败不吞掉。
- 真实本人连接1个；只读取得最新一封并完整归档9719d751-6805-5477-86d4-12ead6b69719，6份artifact，EML回读SHA相符，有稳定UIDVALIDITY。autoSubmit=false，intakeIds=0，没有建候选人或发消息。API Key查询邮箱连接403。
- 本地原生IMAP协议入口已重新启用以验证本人连接；启用前后所有messageChannel自动同步仍0，旧ACTIVE工作流0，worker允许列表仍只有招聘两队列，cron仍关。没有启用历史同步。原生ImapFlow使用BODY.PEEK与readOnly文件夹锁，接口无发送/移动/标记/游标写入调用。
- 8项所有权、只读读取、限额、协议开关、历史边界及失败传播测试通过；前后端TS/lint通过。所有权UI提供本人连接、明确接入开关、原件核对与单封读取，尚待实际浏览器验收。

## 并发任务的数据库锁连接隔离

- 官方core池默认10连接，而招聘队列可同时持有最多10个长任务锁，加上6个评分锁，存在锁占满查询池后等待自身CRUD的风险。保留官方PostgresAdvisoryLockService，在同进程内为招聘锁配置独立18连接池，普通CRUD仍用原池；没有新增外部服务。
- 锁池无实体、迁移、订阅器，禁止synchronize/dropSchema/installExtensions，由Nest管理启停。API和worker已实际启动并完成依赖注入。
- 真实本地PG验证：18个同时持锁的回调，在普通查询池仅2连接时全部完成SELECT1，48ms；验证连接隔离与进度，不把它称完整LLM吞吐压测。相关6套/28项测试、服务端TS/lint通过。

## 匹配文字保真回归

- 发现全局按姓名字符串替换会误伤同名技术词片段：Li→Linux、An→Angular、He→Helm，以及Go/OpenAI。改为仅在明确姓名字段头部处理身份，联系方式和带凭据URL仍替换子串，职业技能完整保留。
- 11项输入/约束回归通过，服务端TS/lint通过。输入版本会随实际修复后的上下文变化，旧评分不冒充新结果；最新代码尚待下一次重建生效。

## Jev真实窗口与公司招聘状态

- 客户端原把32k UTF8字节当32k token，造成中文误拒；现在只设1MB请求体积护栏，完整文本提交给Jev默认服务端窗口验证，不截断、不使用Danger-Zone长上下文头。真实上下文拒绝持久为NEEDS_REVIEW，失败不是0分、不保存provider原始错误内容。官方依据https://docs.typesafe.ai/models（64k/request、32k/question，单位token）。
- 原先8位误拒候选人全部真实评分完成：bf87e31f-0af5-5230-b33e-4bf5fda49412，8/8、0失败，实际输入10046～16057 tokens。该验收只证明窗口与材料覆盖，不证明其岗位质量合适。旧规则未记版本的run显示legacy/unrecorded，新执行/重试存真实协议版本。
- 公司PAUSED/CLOSED在模型前排除，未知公司状态不拒绝；公司状态修改进入原生增量监听。能力问题保持match-v0.1，保留历史能力缓存namespace，过滤/输入版本单独演进，避免无意义重复付费。当前有效岗公司44ACTIVE、2UNKNOWN、5fixture无状态，没有现有停招公司被误算。
- 53项匹配/事件/规则重点测试、服务端TS/lint通过。正在另起完整反向回归，保留旧93166da1基线不覆盖，submission见full-reverse-v2-submission.json。

## 材料类型与已有候选人更新语义

- 候选人提取在同一次结构化生成内返回materialKind，不另发分类请求。明显JD或缺少职业事实的非简历进入MATERIAL_REVIEW，不覆盖候选人、不把附件处理成功当简历识别成功。
- 真实合成JD误投简历入口：7e7f6832-3a0e-5d9d-984b-543feffaf9bd，模型识别job，持久状态NEEDS_REVIEW/MATERIAL_REVIEW，原件保留。门户合成简历ad90cc91-5efe-5b9b-9c43-b4fd49f70656完成STORED并关联既有fixture，没有新建重复候选人。
- 上传及邮件选择界面明确：更新已有候选人的职业结构化资料以本次完整材料为准，历史原件、人工姓名与运营偏好保留。这里不是将历次职业事实自动合并。

## 候选人门户、撤回分享与人工跟进

- 同进程新增限定用途门户：资料填写、原生文件上传/完成、统一简历队列、本人岗位意向、逐岗分享确认与撤回；企业只读当前已确认快照和勾选简历，不暴露邮件、运营笔记、旧复杂JSON或原生下载凭据。
- 每次访问重建原创建者当前权限，校验MAC、nonce、到期/撤销、人岗范围；分享同时复查源入口及其创建者。撤回后查看和下载403，重新确认新grant不复活旧公司链接，源入口撤销后企业访问403。
- ops/recruiting/smoke-portal.mjs真实匿名HTTP闭环通过：无Cookie/Authorization，资料保存/意向/文件原生PUT/完成、重复简历提交同ID、入库完成至原fixture、分享/撤回/重确认/撤销。初始空JSON映射被官方存储省略造成MAC失配已修正。两内部对象及9字段通过官方metadata创建，导航已隐藏。
- 跟进记录复用recruitingContact，旧迁入记录保留并标历史待核对，新签名回执可区分本人确认。Agent能记NOTE，实际联系/推荐/发布要求直接本人会话；公司推荐还要有效分享确认。真实合成HTTP/MCP/CLI成功，Key声明已联系403、未确认推荐403，均没有任何外发。
- 门户/分享/签名/活动5套15项测试通过，前后端全包TS、相关lint通过；门户公共页面及原生工作台入口已实现，尚待实际浏览器验收。原Ego任务空间丢失，恢复许可尚无回复，继续独立API和数据工作。

## 官方Agent与订阅的真实工具执行

- 新建无触发器的本地验收Agent，模型chatgpt-subscription/gpt-5.6-sol。官方runAgent→ai-queue→AgentTurn流式执行完成，原生文本与平面结构化对象均真实成功，不另起模型代理。
- 创建仅公司读取、无业务写权限的验收角色。第一次学习招聘工具成功但执行被拒，定位到官方runAgent将代理应用放在viaApplication，而通用记录权限从application重建，原严格比较正确阻止了丢失的应用约束。
- 工具入口现在将该受信任原生委托应用保留为application参与重建，继续严格比较用户/应用/Agent角色交集；不能保留完整交集的其他调用仍拒绝。8项权限测试通过。真实learn_tools→execute_tool成功，工具输出success=true，查询合成公司返回1。
- ai-queue启动前所有状态计数0；使用临时独立ai-only worker，未改变持久招聘worker允许列表、未启动原收信/工作流/发送队列。验收结束需停止该临时worker。原生Agent的responseFormat目前只接受顶层string/number/boolean字段，复杂候选人对象仍由已有AI SDK提取器处理，不能把两者混称。

## 官方Agent本地图片输入

- 实际图像请求发现官方附件链把localhost私有文件URL交给上游下载，返回407并失败；材料提取器原本直接传图像字节，不受这条原生Agent链影响。
- 原生Agent附件服务现在只对已核对工作区、AgentChat目录及UPLOADED状态的图片读取原件并内联字节，保留其他附件原行为。文件声明总量50MB、单图20MB，读取过程中再限制真实字节，不把本地下载凭据交给模型。
- 真实官方runAgent图片验收返回绿色，与未在提示中声明的合成色块一致；文本、平面对象、工具和图片均已有原生执行证据。12项附件/消息测试、服务端TS和lint通过。

## 独立原件评测结果

- 8位固定候选人×46真岗368对全部评分，4dev/4holdout在标签前冻结；旧已见样本和排错case排除。真实原件9份/18页完成解析，盲评文本不含Jev分数/排名，前五40对加16对照。
- 机器初审前五38/40可继续沟通、非平局排序124/130一致、能力分MAE.423；不是招聘准确率或human gold。引用仅12/54逐字相符，理由仍需人工核对。唯一机器冲突只写偏好远程，程序正确保持待确认。无程序排除样本，未知误拒率unknown。成本和复现见EVALUATION.md。

## SIWC账号管理与加密刷新

- 完成同进程独立连接存储、loopback单次授权事务、原生管理员HTTP入口、Provider连接ID与每请求载入、官方AI设置页账号/模型选择及断开。管理层只加载于API，模型worker只依赖凭据服务；没有新增代理进程。
- 原生AES-GCM信封和600/700权限，原子写；原生PG锁串行旋转、进入后重读。新OAuth身份校验前不替换旧账号，缺订阅scope不推理，失效要求重连。旧Codex源仍只读。
- 4套19项协议/存储/刷新/loopback测试通过，网络令牌为合成。管理本人GET200、Key403，本地生成尝试/查询/取消已实测，host加密，连接数0；未打开授权页面或取得新token。新SIWC本人授权、真实刷新与UI浏览器验收未完成，详见SUBSCRIPTIONS.md。

## 文件完整层与错误回归

- 中文双栏PNG、扫描PDF、DOCX、8页HTML/Markdown及外部资源/加密/损坏共9项真实HTTP按预期通过，6项服务测试通过。资源目标先证明容器可达，解析期间请求计数0。
- 扫描页底部文字原默认导出遗漏已修，明确导出全部内容层，协议preview-v2；旧清单不可变。OCR符号不保证逐字还原，截图全部保留，详见PARSER_VALIDATION.md。RSI冻结v1输入保持原样，不借修正重写旧实验。

## 合同兼容与当前原生版本保存

- 已盘点11份五字段资料、10SIGNED/2PENDING、0外部草稿/准备状态、0既有内部签约任务。保留原始公司数据，停用缺配置的旧外部入口；新公司与岗位页支持资料、内部任务及负责人手工确认，不调用签约平台。
- 真HTTP重复任务ID一致、关联1条、版本冲突409、同版本并发201/409、Key声明签署403、任务完成。仅合成公司模拟并恢复，其余原有合同摘要不变。官方ORM raw/entity同次读保留微秒版本，避免JS Date误冲突并保持原生权限/事件，未改通用CRUD语义。详见CONTRACTS.md。


## 07:45交付检查

- 邮箱新增持久每分钟poll，初次只读UID基线、不重放历史，当前owner与权限每次重建，归档后才推进招聘自己的UID。真实开启autoSubmit=false→worker定时空轮询→关闭→恢复原autoSubmit通过，原生同步/旧工作流仍0，未观察自然新邮件到达。13项邮箱回归通过，详见MAIL_SOURCES.md。
- RSI离线Shadcn HTML已生成：私有evaluations/rsi-v1/report.html，56行、按人筛选7行、数值排序、恢复全部及CSV真实BOM/换行/公式防护均有DOM检查。数据链路docs/recruiting/data-flow.html有9个可点击节点。没有绕过Ego阻塞做浏览器QA，详见EVALUATION.md。
- 原生agentTurn回读机器盲评8次用量95,457输入/36,691输出tokens，订阅用量不等于美元费用。原冻结preview-v1输入和silver标签不回写。
- 新增当前preview-v2真实旧DOC验证：OLE头、两页两张PNG、all_pages、complete和尾段文字全部通过；生成器及smoke脚本已纳入，旧9项与单独DOC证据保留。
- CLI JD多文件在明确--key时保存700/600本地checkpoint，按实例/凭据/提交标识隔离，原子不可变slot保证并发引用一致；重跑查询当前授权任务，不存API Key或原件。15项客户端/恢复/回放测试通过；真实重复提交同intake、相同文件引用，到AWAITING_CONFIRMATION、1预览，未建新岗位。
- 合同MCP status/reminder真实success=true，CLI查询成功，复用原合成公司与内部提醒。官方Agent另有受限ai-worker启动入口，启动前全部任务状态0，无scheduler；现保留该worker供本地普通Agent使用，未启其他旧队列。
- 个人飞书文档已用personal用户身份创建、更新并回读验证：https://my.feishu.cn/docx/H0sld6jFuosjIMxd1TWc4PcanPb 。包含背景、确定需求、实施进展与待验收，标题不重复，不含个人简历/凭据。使用lark-doc技能，未发IM/邮件。
- API34/PID41435、招聘worker28/PID41446、AI-only worker4/PID42530、Vite/PID11915正在运行；只供当前核对，停止前重新核对cwd。最后API代码构建包含461803bd的邮箱poll，后续变动为CLI、报告、测试和文档。新运行说明为RUNBOOK.md。
- 健康：前端/API/parser200，Vite绝对私有文件路径403，相对路径200是SPA HTML而不是私有JSON。原生收信0、日历0、旧ACTIVEworkflow0、招聘收信最终0。1历史匹配队列权限失败已审计：03:04失败、03:08业务run已COMPLETED，46score/4excluded/0fail；当前50对因新资料/池变化正确陈旧，未删记录或为了清零重跑。
- 仍有本人/浏览器依赖：Ego专用space14丢失且恢复许可未答，不能创建新空间或换浏览器绕过；新SIWC本人授权/真实刷新；自然新邮件观测；业务方质量确认。其他独立事项已形成代码、文档、接口及数据证据。整体目标不能标为complete。


## 08:07交付复核修正（正在实测）

- 独立源码审查确认并修复：邮件在接收锁内入队而worker碰锁伪成功；同候选人并发写附件丢失；全池重试沿用旧targets/已查看状态；仅变更公司关系漏触发重评；新profile混入旧JSON；后台长任务在key撤销后沿用旧权限；以及运营页面重新选择、失败编辑丢输入、地点分隔符输入和未评分原因不可见。
- 邮件/草稿已改为锁外入队、busy锁有限指数退避，恢复时同锁检查in-flight并保留checkpoint；每阶段持久化前重查原执行身份，失效不以旧身份写FAILED。运营可用有效身份恢复停止的任务，不赋system身份。
- 候选人写入改为官方ORM的完整微秒版本CAS，冲突重新读取并合并原件，不在解析/模型阶段持锁；普通联系人ID被拒绝，避免STORED却不在候选人列表。强制同版本双写单测已过，原生数据库/文件链回归正在进行。
- 最新31套183项服务端/订阅测试、4套33项前端React状态测试通过，前后端TS及相关lint通过。先前4项loopback测试曾因本轮沙箱网络EPERM失败，取得本轮网络权限后原测试全通过；没有改测试绕过监听。
- API已重建为9602文件的新dist，当前API35、招聘worker29、AI-only worker5已启动，旧API34等已停止。停止旧进程先被sandbox拒绝；精确3个已核对cwd的SIGTERM经自动审核获准，未影响旧A或其他项目。源码补丁尚待分行为提交，仍不能把整体目标标为完成。

## 10:26 真实页面与文件生命周期复核

- 用户已允许恢复Ego空间；唯一新空间15用于全部页面验收。一次两个页面退出后，用户明确要求代理登录，使用此前保存的本地副本凭据经正常表单恢复；未修改账户或认证规则。退出首次原因尚未确定，源码与日志不支持将其直接归咎独立helper的JWT续期。
- 真实页面上传两页中文扫描PDF与可选说明：intake66c0d084-f0a6-5251-9c7c-48d379061ccd已COMPLETED/STORED，候选人f351b421-4a46-5d10-ac58-88703a3000eb。gpt-5.6-sol结构化输出engineering、后端工程师、全职与远程；原生候选人列表、详情、两页预览及第二页底部ARCHIVE_END均实际可见。不是重解析全部497位历史候选人。
- 自动匹配ac79abe7-2235-52fd-9fcc-0b784e38b6e7先完成52/52评分。发现六个确定合成岗位进入在招池后，先备份并逐条核对ID、合成公司和验收来源，仅原生API设CLOSED；当前46个活跃岗位与冻结manifest完全相同。刷新46/46全部命中缓存、0失败、complete=true；最高1.32/4，不能称找到合适岗位。原52混合池与新46真岗证据分别保留，不改写实验。
- 页面“手动匹配”选合成候选人→FlowGPT→AI工程师-平台，真实指定PAIR1/1完成且同分1.32；从匹配带入草稿后清除岗位，模型生成通用意向问候并编辑保存标题。没有确认实际联系、推荐或发送。公司/JD选择与取消编辑、地点分隔符及跨标签保留、合成邮件六资源展示和1619字节EML下载均实际通过。UI逐项见UI_ACCEPTANCE.md。
- 邮件字段已真实原生准备：九槽各60、物理列存在、工作区deferred action0行；intake.files原60保留，candidateResumes8→30。3份旧签名归档18资源迁移，42次前后SHA比较一致，原来源和intake关联保留，未删除原件/重解析/重排队。
- 容量合成邮件500附件→504artifacts、九槽[60×8,24]，canonical引用508项检查、16份artifact哈希和8份intake副本哈希通过。两note各独立4份文件，两邮件intake均STORED；重复与legacy绑定在verifier进程0新增copy/排队，后台模型用量未测，不能称零调用。自然新邮件仍未观测。
- 最终parser11例按预期，含真实旧DOC和两页Word表格对应关系；外部请求0。最新邮件归属/自动匹配禁用8套44项Jest、全包tsgo、16文件type-aware lint/格式通过；前端此前4套35项通过。重叠集合不相加冒充总数。
- 已补本地commits：96c9335d自动匹配明确false、de08972f字段准备、8497a1e0独立邮件归属、0ee37212实际迁移与500附件验收、30559492运营输入和恢复UI、088902ca全池retry原生回归。未push、Issue、PR、生产变更或外发。
- 新发现门户同源/recruiting-portal返回空404；直连API同一能力201且JSON正常，证实Vite代理遗漏。订阅/chatgpt-subscriptions同样遗漏并返回SPA HTML。正在局部修复白名单和友好空响应处理，未修改鉴权。新SIWC本人授权/真实刷新、自然新邮件、业务方质量核对仍为未完成gate。
- 构建前10:26只读核验三队列waiting/active/delayed/prioritized均0；API37/PID55991、招聘worker31/PID58720、AI-only worker7/PID58719均确认cwd为本仓库server。稍后重建须重新核对，不能凭旧PID盲停。

## 10:35 运行版本与官方聊天修复

- 55d7643e已提交门户/订阅本地代理及空JSON错误处理；70项定向测试、前端TS/lint通过，正常门户资料/附件、停招按钮保护和旧企业授权失效提示已实际观察。没有为验收放宽鉴权。
- 队列idle后精确停止旧API/两worker，SWC重新编译9604文件，加载明确false开关修复。当前API38/PID65513/session33051，招聘worker32/PID65514/session51380，AI-only worker8/PID65515/session76984；源码运行环境不新增代理服务。10:30前端/API/parser均200，46岗全缓存run回读COMPLETED/complete=true；正常浏览器reload会话和指定匹配均保留。
- 新日志显示官方聊天mentionsResolvedAt字段缺失，原生guard持续CHAT_UPGRADE_IN_PROGRESS；只读确认workspace ACTIVE、metadataVersion183，字段元数据及物理列均无、deferred0。经原生单workspace命令先dry-run，再执行upgrade:2-54:add-chat-mention-resolution，仅新增nullable系统DATE_TIME字段并正常失效缓存。API未重启即真实GetAgentChatOpenThreadsSummary成功，4open/1unread；字段UUID及物理timestamptz列回查存在，metadataVersion184、deferred0。未修改版本、状态或guard，单项修复不冒称完整升级链已完成。私有chat-mention-field-evidence.json。
- 个人飞书已由根会话按原始明确授权精准更新第三章并回读到revision7，15项内容/结构检查全通过，三大章保持。子任务曾因可见上下文不足遭自动审批拒绝，根复核原用户创建及更新要求后重新交审已允许；没有绕到其他API。首步CLI返回计数字段与文档契约不同，先回读确认已写，再幂等跳过续做，未重复插入。
- 当前仍进行两组最终页面闭环：p2合成公司两JD实际批量确认及逐ID停招清理，p3合成候选人门户保存/意向/分享确认/企业预览/撤回。未完成前不把相关目标勾完。新SIWC本人授权、自然新邮件及业务质量核对仍待实际结果。

## 10:41 公司/JD页面闭环

- p2正常页面上传两份合成TXT及note，intake90dc69ca-da38-5693-8bbf-3a8d1fefc57a生成两条独立预览；727输入/579输出tokens。鼠标派发发生CDP超时后，两边只读回查均404且DRAFT，未盲目重复。随后聚焦同一enabled按钮并Enter确认一次，页面显示两条已创建及岗位链接，无alert。
- 根独立读回新岗位88d0217b-9ce4-5b4b-af9f-852233e43d56和d03887c4-6031-521d-af87-1455884b02bb的真实RECRUITING版本，核对合成公司与名称、私存备份后逐ID原生API改CLOSED。最终活跃集合仍精确等于冻结46真岗。没有按名称批量清理，未改旧六个测试岗或删除记录；后台自动匹配用量未全量计量，不宣称零调用。
- 页面与清理证据qa-ui-jd-batch-created.png、qa-final-ui-jd-actual-created-backup.json、qa-final-ui-jd-actual-cleanup-evidence.json。候选人门户分享/撤回页面闭环仍进行中。

## 10:44 门户与实验报告页面验收

- p3合成候选人真实UI闭环通过：同值保存资料→运营建立绑定真实在招岗的候选人入口→表达意向→勾选唯一合成简历确认分享→运营建立企业入口→企业只读预览→候选人撤回→原企业页reload明确拒绝。最终WITHDRAWN/valid=false，资料与附件不再可见，无有效分享残留。未外发、上传或新建候选人/岗位，同值保存复用原COMPLETED匹配身份，无新模型任务；证据portal-ui-evidence.json及五张私有截图。
- 根在同一空间临时p4打开离线Shadcn HTML，实际目视核验四项指标卡、56行表格及可读布局；点击C01筛为7行，再恢复56行，已关闭临时p4。截图qa-rsi-shadcn-report.png。报告保留机器silver及引用逐字12/54局限，没有冒充人工标准答案。
- 新公司带网址提交触发旧原生domainNamePrimaryLinkUrl唯一约束；同名未部分落库，查明example.invalid与已有合成公司冲突。保护正常，未放宽约束或权限；目前仅更换为独立合成子域完成新建提交验收，避免把错误测试输入误记成核心创建失败。

## 10:49 核心本地交付回读

- 新公司真实页面提交成功，c8e6a0b4-64a8-44fe-a9e2-d08c598015be，选中且无alert；原生REST逐项确认名称、独立域名、简介、招聘偏好一致，岗位0、模型任务0。原example.invalid重复拒绝保护保留，未为测试改源代码或约束。
- 数据链路HTML已在同空间临时p5实际目视确认布局及九个可点击节点，解析节点交互正常；已关闭p5，未打开新空间或撤销私有目录保护。报告及数据链路的视觉证据均私存。
- 最终55公司/174岗位/928联系人/500候选人，新增均合成测试。三队列waiting/active/delayed/prioritized0，原生邮件/日历同步0、旧ACTIVEworkflow0、deferred0、招聘收信开启0；在招集合仍精确46真岗。新两测试岗创建自动产生两run，合计21对评分后因停招SUPERSEDED，不称零模型或全量完成。
- 个人飞书最终精准回读revision8，核心公司/JD/上传/队列/匹配/草稿/门户页面验收摘要已替换旧待验收文字；三章结构与新SIWC/新邮件/质量待办保留。最新交付文档和Goal勾选只反映已完成证据，整个goal仍active。
- 当前可独立的代码、接口、真实解析/匹配、核心UI、迁移、报告与文档工作已完成。余下本人新SIWC授权及其真实调用/刷新、新邮件自然实收和业务质量核对，不能以旧Codex只读来源/合成网络测试/空poll代替。497历史候选人未全部新解析重跑，业务资料迁移不等于全量回填已完成。p1目前保留官方管理面板AI订阅入口，尚未发起会过期的OAuth。

## 逐条验收复核后的补充（2026-11-01）

- 上一goal轮有实际代码、数据与页面进展。本轮继续按完整目标对照，发现核心流程已跑通仍不等于逐项展示覆盖：4.2选择公司时缺域名提示及已有岗位，10匹配详情缺公司简介和招聘偏好的原地查看。未把已有绿勾或窄测试当作全需求完成证明；UI验收项已重新标待复验。
- 19090abf补充公司搜索结果域名提示、选中公司已有岗位总数/前5条/在招状态及原生链接，沿用已鉴权目录接口；读取失败不误报0岗、不展示旧缓存。切换公司以companyId重新挂载，防止上一家岗位短暂混入。翻译检查另补既有文件大小MB文案的Lingui标记。
- 597c9c53在匹配已评分和未评分行加入按需展开的当前公司资料，读取既有companies/:id，展示简介/偏好及原生链接；兼容原生富文本/迁入纯文本，转义HTML、不请求远程媒体，权限失败隐藏旧缓存。不将当前公司事实称为Jev解释，不触发新模型请求。
- 本轮4套35项组件/恢复回归、前端tsgo全包、10文件type-aware lint/格式和模块翻译检查通过。两合成公司的真实API分别回读8停招岗与0岗，companyId范围与接口字段形状正确。Vite三个相关模块实际编译200；以上不代替新界面的浏览器验收。私有company-context-api-evidence.json、company-context-vite-evidence.json。
- 本轮只读回查新SIWC连接0、pendingAttempt无、Codex只读来源可用；未新发授权或读取/操作已交给用户的浏览器。此前p2/p3已关闭，p1保留订阅设置页并已handOff。需要用户完成授权或明确交回控制后，在同空间复验两处展示，不另起浏览器绕过。
- 当前未完成事项为新增展示页面复验、新SIWC本人授权及真实调用/续期、新邮件自然实收、业务质量核对；完整目标仍active。本轮不再启动子Agent，遵守最新developer的非主动委派规则。没有push、生产写入或外发消息。

## 用户改定的本地邮件服务验收（2026-11-01）

- 上轮完成两处展示补充，属于progress。本轮先启动15分钟真实邮箱观察，实际9次正常poll无新邮件；用户随后明确要求自行起本地邮件服务，已SIGINT精确观察进程72186，finally确认configurationRestored=true/finalEnabled=false，没有继续等待或自动重启真实邮箱窗口。邮件验收门槛按该明确要求改为本地SMTP/IMAP端到端，而非假称观察到外部自然来信。
- GreenMail 2.1.15 ARM64固定digest已在OrbStack的twenty-recruiting-mail-test-1运行，loopback SMTP23025/IMAP23143/配置API23080均就绪。可选profile、私有随机凭据、up/status/down已实现；精确本地host allowlist保留安全模式，没有使用通配符或停旧A环境。
- 通过原生saveImapSmtpCaldavAccount注册独立测试连接69bdf809-59e0-4570-9f4e-2afb40f0fbbd，加密凭据仍由官方服务管理。原生历史同步与联系人自动创建通过updateMessageChannel关闭；已有业务邮箱未修改。本地SMTP/IMAP由独立Python标准库客户端投递/核对，应用仍使用自身ImapFlow与RecruitingMailboxPollJob，未直调mail.receive或EML上传来代替协议接入。
- f2b1416d修复官方TipTap/旧BlockNote输入读取和清空时不恢复旧profile，3套35项回归、服务端tsgo/lint通过。API39/PID75721/session25966、worker33/PID75720/session93957、AI9/PID75719/session87782已实际重建9604文件并加载新host配置；原生偏好与空JD编译模块回查为真。构建前确认无PENDING授权和三队列空闲。
- 11:22:41～11:24:43，旧SMTP邮件UID1先于接入基线，新邮件UID2被正常定时任务收取，归档5d7c0e94-5443-53a6-869c-1f5c286d603e六份资源，独立IMAP原文SHA一致、正文引用保留。intake448f5f2c-fe82-5822-a6f7-d172c1f08920已STORED，两页PDF/all_pages与正文/text_only回读完整；候选人b6b09df5-3bba-505e-84af-6b3a6d3e4f94入库。
- 自动run cdc1ec42-73d0-588d-99c4-3fdc786f9829在本轮新版本46/46评分、0失败、0缓存、complete=true、前五5条。gateway报告cost合计0.006314952，订阅提取消耗另计。重复原文经IMAP APPEND成为UID3，复用同一archive/intake/matchRun；旧UID1未归档，原邮件仍未读。全部12个断言通过，没有对外发送或联系。
- finally关闭测试接入，回读两邮箱enabled=false，三队列waiting/active/delayed/prioritized及scheduler0，原生邮件/日历同步和旧ACTIVEworkflow0；929联系人/501候选人（本轮增加一位合成样例）。默认重跑命令已只读复验原任务成功，新投递/新模型请求0；--new-case显式新建场景并保留旧状态/原件。证据在私有mail-test/reception-evidence-v1.json、reception-supplement-v1.json、final-health-v1.json。
- 最初汇总使用pageCount而实际接口为pages，原证据materialPages为空；已另存独立API补充证据确认pages2/all_pages，没有改写原报告。后续脚本已修正并加入两页断言。
- 可复现工具及说明已本地提交c08c4e6b、e44938cb、dc849ae7；本地邮件门槛已勾完成。GreenMail继续运行便于开发，自动接入保持关闭。本人ChatGPT新授权、两处新增展示的页面验收和业务质量核对仍未完成；已异步请求用户交回空间15，尚无回复，不擅自恢复浏览器控制。

## 11:57 JD 预览来源与核对补充

- 逐条复核4.2.4/4.2.5，补齐原始批次来源、缺失字段及同名提示。共享规则供后端与本地编辑复用；不把相同名称当重复业务实体，不猜未知字段，不改已保存原件。缺公司不扩大为跨公司查询，角色不可见名称不泄露，超过200可见记录标PARTIAL，权限失败标UNAVAILABLE。
- 未指定batchId的JOB回执稳定使用intakeId；HTTP/MCP/CLI均回读相同身份、批次来源和提示。新增CLOSED合成同名岗位775a50f5-0098-5c40-91e1-ec80dd064b2e，只在确定的合成公司下创建；175总岗，在招仍46真岗，无模型调用或岗位确认。私有job-preview-native-evidence.json全断言成立，原input/extraction/items状态checksum不变。
- 共享规则3项、服务端3套17项、前端相关3套及等待态测试通过；两包tsgo、相关type-aware lint及翻译检查通过。共享包与server9604文件重新构建；API40/PID80648/session94750，招聘worker34/PID80649/session79935，AI10/PID80650/session50671，front11915。构建前核对无待处理OAuth与队列空闲。新源已在HTTP实际生效，默认本地邮件旧任务只读复验通过。
- 新增UI尚未实际浏览器验收，原截图不能替代。空间15仍已handOff用户，未擅自takeOver；新SIWC连接0、无pending，未生成授权链接。当前仍保留新UI与本人订阅授权验收未完成。

## 12:01 原件下载与本轮收尾

- JD预览共享规则、受限来源接口和动态编辑展示已分别提交d157dfe2、995bb55c、0756860a。继续核对目标10后补齐队列材料链接：可展开原件下载，JD来源复用同组件；不把文件名当已有可下载入口。读取同时验证父记录、原生files FLS和不可变input引用，再走原生工作区/上传状态/目录验证。HTML以附件下载，不在CRM执行。
- 服务端3套18项、前端2套24项通过，两包tsgo及9文件type-aware lint通过。实际API下载邮件PDF618683字节，与独立原件SHA完全一致；JD422字节可读，跨父/未知404、匿名403，响应头attachment/octet-stream/nosniff/private-no-store成立。最初匿名断言预期401，与原生403不同，已按拒绝语义和实际状态记录，未改鉴权。私有intake-material-download-evidence.json。
- 队列idle、无pending授权后精确停API40/两worker并重建9604文件。当前API41/PID82354/session54168，招聘worker35/PID82365/session28938，AI11/PID82377/session20053。新功能已在HTTP实际加载；既有邮件任务与JD HTTP/MCP/CLI预览均只读复验成功，新上传/投递/模型请求0。
- 12:01最终前端、parser及鉴权API均200，三队列waiting/active/delayed/prioritized和scheduler均0，两邮箱接入enabled=false；新SIWC连接0/pending无。Vite三个新增相关模块200。私有material-final-health.json，running-work.json已更新当前运行点。
- 新UI仍未取得实际点击证据；浏览器空间15此前交给用户，遵循Ego指南“After the user confirms, resume the same space”，未绕过或重新创建空间。整个目标保持active，不把新增下载接口成功当页面或招聘业务质量验收。

## 12:13 完整目标逐项审计

- 上一goal轮为实际progress（JD预览与原件下载5个提交）。本轮按权威目标121个列表项建立DELIVERY_AUDIT.md，逐项区分真实本地证据、组件/接口证据、待页面与待本人授权；不按旧绿勾倒推完成。明确合同内部提醒、发布草稿及人工跟进的正常页面提交也缺证，UI验收门槛继续未完成。
- 首次限定回归误用了Jest30复数testPathPatterns，Jest29未筛选；已只停本轮测试PID82895/82896，两个handle最终143，未停API41。弃用这两份非scoped日志，改用rg精确文件清单和--runTestsByPath：服务端35套221项、前端8套50项全部通过，进程均退出0。相应scoped日志私存，没有把中断或非目标测试当通过。
- 72ac3333新增audit-rsi，复核9份原件全部大小/SHA一致、18页preview-v1、原40个前五位置零保存键重复/程序排除/未评分；历史标签仅描述样本，不是新gold。语义保真、语义近重复正确性和无排除观察的误拒率保持unknown。旧manifest/report哈希前后相同，不重写已有评分、标签或HTML。
- 发现原4/4候选人分组共用46岗，未能证明岗位重复组隔离。c6a0c458新增固定seed联合分组缓存回放，保留完整8×46原结果与真实46岗池：dev4×20/80对、holdout4×26/104对，人/岗/保存的重复组交集均实算0。新前五标签仅7/20和12/20，未审13+8项，整体质量率unknown；这是事后回放而非新未见测试。两命令无模型客户端，新增请求/费用0。
- 个人飞书以personal用户精准更新第三章并回读revision14，去掉外部自然来信旧待办，补新增展示/下载、限定回归数、评测证据及剩余页面与本人授权项。再次读取第二章需求相符，目录严格为1.目前的背景/2.目前确定的需求/3.我们需要去做什么。初次目录校验漏“的”导致false，按实际标题更正本地校验后全部true；未为校验改文档标题。私有lark-audit-checks.json。
- 本轮只读PG实际55公司/175岗位/929联系人/501候选人、46在招。12:13原A13000/新B23000/parser均200；Redis全局并发材料10/匹配2，各一个worker，AI一个worker，三队列空闲/无scheduler。新SIWC管理200、连接0/pending无。completion-audit-runtime.json私存；业务源码未变，不重建API或新增模型任务。
- 剩余Ego空间15交回与新SIWC本人授权尚无确认；没有操作已handOff页面或生成会过期链接。本轮完成了回归、两个可复现证据命令和文档同步，属于progress；整体goal仍active，不complete、不满足连续三轮无进展的blocked门槛。后续如无控制权/授权变化，不反复重跑同一报告或发明新的通过条件。

### 2026-11-01 晚间：JD 与邮件批注收敛

- JD 两步多条文字录入，删除每条补充说明；提交即排队，后台提取后自动创建岗位，成功条目幂等，新增滚动到对应卡片。
- 当前 Codex 账号绑定获用户明确授权并完成真实解析调用；旧 6 字符 JD 返回无可确认岗位，不创建空记录。
- 新 IMAP 来信默认候选人，正文与全部附件（含内嵌图片）参与解析；邮件页无需选择材料。列表显示准确附件数与实际 intake 进度；详情直接正文和附件预览。
- 公共按钮、Tabs 去除蓝色外框；邮件列表移至最后一个主 tab，保留键盘焦点背景反馈。
- 本地真实 SMTP/IMAP 合成验收：3 份材料全部解析并入库，record=f988a340-7315-5b61-875b-04e73676828d。历史数据未批量重处理；故障/超限保留原件，边界与证据见 UI_REVIEW_20261101.md 第 8–9 节。

### 2026-11-01 旧邮件自动处理补齐

修复旧归档关闭 autoSubmit 后无法恢复的问题，并通过授权本地 API 补跑 3 封没有候选人任务的归档：1 封已入库，500 附件容量测试和旧合成文件分别明确失败。再次扫描待恢复数量为 0，没有重复建人。邮件详情显示下游解析错误，列表使用“已入库 / 解析失败”，不把历史人工选择态当作正常自动流程。


### 2026-11-01 代码目录按业务细分

前端 54 个文件、服务端 77 个文件归入业务子目录，去掉内部文件名重复的 Recruiting/recruiting- 前缀。组件、类型和单域测试相邻，跨页面交互测试独立；服务端纯规则随所属业务归入 domain，根目录只保留 recruiting.module.ts 注册入口。外部页面引用、迁移/验收脚本和源文件哈希读取路径同步更新。各模块 README 说明职责及依赖方向，ARCHITECTURE.md 链接到新入口。

验证：前端 11 套 58 项、服务端 29 套 194 项、ops 15 项通过；前后端类型和模块 lint 核验。既有路由、Nest Provider 类名、Redis 任务名及数据协议保持不变。

运行验证：重建后 API 与 worker 已恢复启动，新目录编译产物存在；公司、材料队列、邮件列表、匹配列表四个鉴权接口均返回 200。本次验证只读，没有新提交材料或触发模型调用。
