# 招聘重建的架构决策与调查依据

核对日期：2026-11-01。源码基线：官方 `c0ad263b`。本文件记录已确认扩展点与实施选择，运行验收见 `PROGRESS.md`。

## 1. 官方已有能力

| 能力 | 源码/文档结论 | 本项目复用方式 |
| --- | --- | --- |
| 对象数据 API | `/rest/`、`/graphql/` 根据工作区元数据生成，标准和自定义对象均支持 | 公司、候选人、岗位和业务记录继续可通过原生 API 读取 |
| 元数据 API | `/rest/metadata/`、`/metadata/` 管理对象、字段和关系 | 不手写业务 SQL 建表，使用官方元数据/应用安装定义 |
| 权限 | API Key 可分配角色；OAuth 继承用户权限；RecordCrud 根据 authContext 构建查询权限 | 统一业务服务复用 RecordCrud，禁止用管理员 key 代理所有用户 |
| MCP | 官方 `/mcp` 已存在，支持 OAuth / Bearer；learn_tools/execute_tool 使用统一 ToolRegistry | 添加招聘领域工具，避免再部署一套通用 MCP 服务器 |
| 应用工具 | LogicFunctionToolProvider 会暴露有 toolTriggerSettings 且调用方可访问的应用函数 | 优先原生应用工具；需要同进程服务的动作按官方 DefineTool 接入 |
| CLI | workspace 名称是 `twenty`；有 data list/get、api rest/graphql | 复用目标/鉴权/JSON 输出；补文件上传、业务命令及异步等待薄层 |
| 文件 | 前端 SDK uploadFile 上传 Blob 到 FILES 字段并返回 fileId/path；CLI 当前 REST body 仅 JSON | UI 使用官方文件能力；远程 Agent 使用授权上传结果/fileId，不能传服务器本地路径 |
| UI | 官方 UI 已有组件、主题和 front component 运行时说明 | 优先 Twenty 组件；共享包版本与当前 SDK 保持一致 |

文档来源：[APIs](https://docs.twenty.com/developers/extend/capabilities/apis)、[MCP](https://docs.twenty.com/user-guide/ai/capabilities/mcp)、[Front components](https://docs.twenty.com/developers/extend/apps/layout/front-components)、[Twenty UI](https://docs.twenty.com/ui/getting-started)。以上是能力核查，不代表本地新环境已完成连接验收。

## 2. 数据复制与新实现的边界

数据副本先复制到独立空库，运行官方代码升级，保留既有关系、文件 ID 和人工运营历史。复制数据库不意味着复制泛函的核心代码补丁。

旧自动化在新副本启动前停用：核心/工作区工作流、逻辑函数触发器、Webhook 和邮箱同步。新业务由新服务接管。保留原始 dump 和 A 环境，支持逐项对照；不在新业务实现里复活旧 Codex 执行器。

公司/JD 原始输入来源需要单独保真：当前表存在 JD 正文、岗位招聘偏好、公司偏好快照以及 legacySource，但不保证保存了原始 JD 文件。无法恢复的来源标记缺失，不能用 jobSearchJson 伪造原件。

## 3. 共享领域服务

统一调用关系：运营页面 / 原生 MCP / REST / CLI → Recruiting 领域服务 → 官方权限、文件、对象和队列 → 解析/模型适配器。

领域服务负责幂等、任务生命周期、批量子项、资料版本、确认、匹配缓存与人工状态。模型不直接写库；API 与 MCP 不能各自绕过相同规则。外部调用是异步提交/查询，避免占着 MCP 请求等待长任务。

当前可使用官方 RecordCrud 服务构建权限上下文，不需要以 `ignoreAllPermissions` 实现业务。后台任务需要记录 actor 并重新校验当前授权，不能永久保存访问 Token 作为运行权限。

## 4. 实习生界面

- 公司与岗位：选公司 → 可就地建公司 → 添加/粘贴多份 JD → 预览列表逐行确认 → 批量提交与逐项进度。
- 候选人：添加材料和可选说明 → 提交 → 队列查看阶段和失败 → 打开 Twenty 候选人记录。
- 匹配：候选人/岗位两种视角共享结果；详情显示双方职业材料、公司上下文、明确冲突、待确认和模型能力分。
- 多文件和批量编辑使用正常页面，不做层层弹窗；短进度查看保留队列弹窗。
- 采用官方颜色、间距、图标、按钮、输入框、状态组件和记录列表；缺失组合组件再在业务应用中组合，不另引入第二套视觉系统。

交互参考：[Carbon 文件上传](https://carbondesignsystem.com/components/file-uploader/usage/)建议展示各文件状态并避免多文件上传塞进弹窗；[Carbon 数据表](https://carbondesignsystem.com/components/data-table/usage/)提供选择后批量动作和展开详情模式。只借鉴交互原则，不引入 Carbon 组件。

## 5. 逐对匹配与快速评测

共享 PairEvaluator 接收一位候选人、一个岗位及公司上下文。先检查明确可投条件，再运行 Jev；能力分不承担所有业务条件判断。当前 46 个在招岗位直接逐对评分，Embedding 作为可选实验对照，不先挡掉潜在好结果。

缓存包含工作区、候选人/岗位 ID 与内容版本、公司上下文版本、协议与模型标识。双向排序只改变视角，不重复定义评分规则。

评测先复用 30 人 × 46 岗缓存，将输入错误、规则错误、模型判断和标签分歧分开。旧 150 项 Agent 审阅不是用户确认的标准答案。调优集与保留测试集按候选人分组，报告约束违规、未知误拒、前五效果、排序、完整覆盖与成本；不以迎合当前 Agent 判断为唯一目标。

## 6. 订阅转换在 Twenty 内运行

CLIProxyAPI v8.0.48 是 MIT 许可的 Go 项目，模块路径为 `/v8`。它的 SDK 使用文档仍有 `/v6` 示例，不能直接照抄。Go SDK 可以嵌入 Go 主程序，不能直接作为 NestJS 的 TypeScript 模块导入；把二进制放进同一个仓库也仍然是独立运行的代理，不满足用户要求。

实施选择：在 Twenty 服务内部增加订阅 Provider/连接模块，参考并按许可移植必要的授权、刷新和流处理行为，不打包整个代理路由系统。与普通模型配置共用 AI SDK 入口，不用 HTTP 回环代理绕过内部权限。

OpenAI 官方目前已提供直接订阅授权：动态客户端注册、PKCE、state/nonce、ID Token 校验、账户专属模型目录、公共 Responses API。优先使用该路径。它要求 `store:false`、`stream:true`，并收到 `response.completed` 才能算成功。令牌、模型目录和路由必须属于同一授权协议，不能把 Codex backend-api 的 token 与公共 Responses 混用。

CLIProxyAPI 同时包含旧 Codex OAuth 与 SIWC 实现，作为对照；必要移植代码保留 MIT 许可和版本来源。所有登录态由连接模块保存，招聘任务只引用模型配置；普通运营/API 调用者不能读取或导出上游 Token。

来源：[CLIProxyAPI v8.0.48](https://github.com/router-for-me/CLIProxyAPI/tree/v8.0.48)、[SIWC 实现](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.48/internal/auth/codex/siwc_auth.go)、[官方授权](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。真实订阅验收仍需本人授权，不用模拟请求代替。

## 7. 并发保存与原生文件副作用

候选人的原件归档在解析时完成，候选人行的附件合并在保存时重新读取，携带原生updatedAt完整微秒版本执行条件更新。冲突只重读合并，不重新解析或调用模型；不在模型等待阶段占用数据库行锁。新职业事实按本次完整材料替换，人工姓名、偏好及历史附件保留。

真实原生ORM回归揭示上游文件生命周期边界：条件UPDATE实际为0行时，原实现仍可能将待关联文件设为permanent或soft-delete旧文件，并产生未实际发生的更新事件；版本已经变化而before-image为0行时，文件同步又会误报多行更新。局部修正WorkspaceRepository.performMutation：对象/字段权限及RLS保持原样，文件更新未选中记录时返回空结果，实际UPDATE为0行时在文件持久化和事件前返回。没有放宽文件绑定或temporary规则，没有改insert/batch路径。

原生repository的12项回归包含真实FilesFieldSync的零行/成功路径。另以确定性合成候选人、原生上传/复制、真实Nest与PG强制双读同一微秒版本：3次mutation中1次0行，最终1份原附件和2份新附件均保留，关联文件均permanent，职业资料未改变。该验证无模型调用；旧合成候选人的8份字段上限未被调高，使用独立fixture，未更改原业务资料。

## 8. 原生富文本与匹配版本

官方RichTextFieldEditor保存的是tiptap JSON，并将markdown/blocknote置空。招聘读取器原先只取markdown，会遗漏原生编辑后的JD、公司或岗位招聘偏好；当前复用twenty-shared的原生TipTap解析/Markdown转换和旧BlockNote转换，先读有效当前文档，再读旧格式，纯文本和原Markdown输入保持原值。编辑器元数据不作为招聘事实导出，转换后仍执行联系方式及带凭据URL的最小化。

显式清空的原生正文或偏好保留为空，不再因逻辑或运算恢复旧recruitingProfile快照；仅原生字段未填充时保留历史profile兼容。新正文进入内容版本与公司版本，已有原生事件监听据此增量排队，不需要另起监听器或重跑无关组合。3套35项上下文/变更监听/匹配回归通过，含6项格式与清空/脱敏用例及原生富文本变更排队；服务端tsgo与相关lint通过。运行生效情况以PROGRESS的重建记录为准，不以源码提交冒充已加载。
