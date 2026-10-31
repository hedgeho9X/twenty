# 执行进度与证据

更新时间：2026-11-01，Asia/Shanghai。

## 当前状态

- 用户已明确授权开始自主执行全部本地外包工作。
- 权威目标：同目录 `DELIVERY_GOAL.md`；后续恢复必须先读取，不能只依赖对话摘要。
- 分支：`codex/fanhan-local-rebuild`，基于官方 `c0ad263b35a734dbd2528bf82c5dd38d3b18dc1b`。
- 官方应用尚未启动；独立数据库/缓存已启动并迁入完整本地副本，旧 A 环境保留。

## 已核实

- 当前官方源码版本 2.55.0，已有 REST、GraphQL、原生 `/mcp`、角色鉴权和新的 CLI。
- MCP 通过 `ToolRegistryService` 暴露原生及应用逻辑函数工具；需要进一步核对业务工具注册和文件传输边界。
- CLI 有 `data list/get`、`api rest/graphql`；当前 REST 请求只支持 JSON body，文件上传尚需薄封装。
- 当前 `twenty-ui` 有公开组件/主题文档，应以当前源码导出为准，不照搬旧组件路径。
- 旧本地库只读盘点：53 公司、166 岗位、163 公司关联、163 JD 正文、139 岗位偏好、100 公司偏好快照；25 公司有招聘偏好。
- 旧 intake：3 CANDIDATE、1 JOB；原始材料不能由派生 JSON 无损重建。
- 实验：30 人 × 46 岗真实 Jev 全量评分已完成；当前选择逐对评分，明确约束先由程序处理。旧向量召回不是当前默认 Pipeline。
- OpenAI 官方 SIWC 文档明确公共 Responses 路径和账户模型目录；CLIProxyAPI 的 Go SDK/协议实现仍在核对。无新本人授权，未发真实订阅推理。

## 下一步

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

- 新增 `src/modules/recruiting/domain/match-policy.ts`：只过滤明确冲突，保留未知；支持岗位同时接受多种雇佣/办公方式，远程与城市条件分别处理。
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
