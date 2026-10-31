# 恢复执行入口

每次恢复先读 DELIVERY_GOAL.md（权威完整目标）、PROGRESS.md，再核对 git 状态和运行。用户已睡觉并明确 Go，目标 active，无 token budget；不得重新创建、缩小范围或仅因停止而标完成。不要 spawn 子Agent，不自行push、Issue、PR、部署、生产写入、外发消息。

## 1. 唯一底座与运行

- /Users/jerry/code/personal/projects/twenty；个人官方fork hedgeho9X/twenty；分支codex/fanhan-local-rebuild；官方base c0ad263b35a734dbd2528bf82c5dd38d3b18dc1b，源码2.55.0。旧fanhan-twenty只读参考。
- 新B：UI localhost:23000；API127.0.0.1:23001；parser23003；PG25432/recruiting；Valkey26379。保留A localhost:13000与所有fanhan-local-*，不动无关AirJelly/Supabase。禁止Supabase CLI及绕过。
- 当前API session1524/PID21310，日志api-15.log；worker session6752/PID21321，日志matching-worker-11.log；front session65848/PID11915/front-2.log。先lsof/ps/cwd核实，不能盲kill。
- worker只启recruiting-queue（10）与recruiting-match-queue（2runs×3pairs）。RECRUITING_AUTO_MATCH_ENABLED=true；旧18工作流在B均停、邮箱/日历同步关、旧logicFunction触发器关，旧sidecar停。
- 新增草稿表时曾有10项deferred schema action；已临时运行workspace-queue worker，仅确认过的一项RunDeferredWorkspaceMigrationActionsJob，全部完成并停PID20867。不要常驻或盲开其他队列。
- 固定Node .local/recruiting/runtime/node-v26.12.1-darwin-arm64/bin/node。私有env、session、模型、报告、原始材料都在被忽略的.local/recruiting，绝不打印/提交。STORAGE签名key与独立RECRUITING_STATE_SIGNING_KEY要保留备份。
- RECRUITING_ALLOW_LEGACY_STATE_SEALING=false，维护入口已关闭。不要再开。Vite fs.deny **/.local/**已经实测403，不撤销。
- 初始迁入53公司/166岗位/925联系人/497候选人/1206文件；另有fixtures 1公司/5岗位/1候选人。新增长JD仅预览，没有确认创建。

## 2. 已完成切片与证据

- commits：6d6f426b 原生MCP/CLI与正确外部计量；cc6a2ef5 原生4入口UI；38a4cd1d 旧入口隔离；681870d1 完整长材料分段；38400398 草稿队列/人工核对；2ccf86d6 草稿MCP/CLI；c461e298 草稿UI。先核对git log/status。
- 既有统一上传、Docling截图、Output.object、公司/JD稳定itemId确认、内置只读订阅、Jev逐对评估、签名内部状态、双向队列/原生变更自动匹配已真实运行，详情见PROGRESS，不重做。
- MCP简历intake79e49a46-13e1-59c2-b8f9-e5c12f09c5bf已入库；自动run44db8f12-a284-54d6-8353-6f55d6bbf085为50总数/46评分/4排除/0失败，COMPLETED，complete=true。指定pair a7130f25-e39e-5d09-bcce-313ab0f2759c完成并缓存复用。
- MCP JD intake bad7af8f-4a54-51e3-8f30-992fe0bb144e→合成岗位2cbca970-1038-55e1-a334-311a4c1b26b6；重复确认同ID。
- Key外部115次请求99通过/16次429/0其他错误，未提高或关闭外部限流；内部CRUD仍有原生权限/审计/存储额度。受限Key越权拒绝且已revoke，之后403。
- 长材料：3b102eea-cf1a-5e4b-8e70-b6e7f5088c2f，265104字符/555242字节，10段事实+最终结构化合并，末尾Iceberg/Trino及45000薪资保留，AWAITING_CONFIRMATION。不创建/发布。真实长页图仍待验证；Jev超限仍未解决。
- 草稿真实订阅：effd92fe-1a3d-502c-8a9a-82b9ab38a829问候，edac60c2-340e-5713-9d90-1a7bdef1ada2岗位发布；API Key核对403，直接会话合成核对APPROVED，retry不覆盖文案。MCP/CLI已读回APPROVED。没有任何发送/发布。
- 新页面/recruiting-workspace：公司岗位、候选人上传、匹配待查看、手动匹配、问候/发布草稿；队列弹窗，匹配行带入草稿。官方组件/主题/图标，无新UI库。源码TS/lint通过，不等于视觉验收。
- 原生metadata隐藏旧运营工作台/旧Skill入口及4个内部表导航，停3旧匹配/沟通页动作；合同入口尚保留。configure-navigation.mjs与私有首轮backup可回退，尚未演练。
- 旧source自述fallback/URL清理已在运行版本生效；旧fullreverse93166da1... 421评分/77review是修改前证据，不能冒充最新。尚需以最新规则重新回归（复用有效缓存）。

## 3. 浏览器阻塞

- 已读ego-browser Skill，曾在专用空间14登录B并看到公司表。空间14后来消失，已inventory确认。已向用户异步请求允许重建，尚无回复。
- Skill明确禁止用新TaskSpace恢复丢失Page。不可自行新建、接管用户其他空间、绕到CUA/Playwright；旧space10授权页也不能动。仅浏览器QA等待，其他工作继续，不称UI验收完成。

## 4. 认证、模型与测试工具

- 内置订阅只读~/.codex/auth.json（不复制/刷新原登录），nativeProvider chatgpt-subscription/gpt-5.6-sol，文本/图片/object真实通过。SIWC连接/PKCE/加密刷新/设置UI与普通Agent/tools尚未完成。订阅sidecar已停。
- Extractor默认官方smart档，RECRUITING_MODEL_ID可固定实验。Jev nativeGateway recruiting-gateway/typesafe-ai/jev，独立key ~/.config/candidate-ranking-algorithm/.env，只内存加载。不要称Jev属于ChatGPT订阅，别猜模型ID/底层版本。
- 正向Admin测试Key在.local/recruiting/agent-integration-keys.json[0]，expires2026-11-01T20:02:47Z；[1]受限Key已revoke。不能cat此文件。nativeAPI默认100/min，不增加限额。
- local-api.mjs仅B、自动renew私有session；localRequest返回Response，需要.json()。AdminAI GraphQL是/admin-panel，普通metadata是/metadata。MCP响应可能SSE，解析event/data，别直接response.json()。
- build：node ops/recruiting/build-source.mjs twenty-server build；等完成再启动API/worker，防dist暂缺。Nx发现曾卡死。tsgo全包在各package cwd用../../node_modules/.bin/tsgo -p tsconfig.json --noEmit。Jest --config jest.config.mjs --runInBand --watchman=false --runTestsByPath。
- 最新drafts-typecheck-4、drafts-front-typecheck-2空输出通过；drafts-lint-3和drafts-front-lint零错误；drafts-tests-2为9项通过，CLI5项。后续修改再跑必要检查，不无意义重跑全部。
- CLI薄层ops/recruiting/cli.mjs，凭据env；项目skill.agents/skills/recruiting/SKILL.md已经skill-creator校验，没有全局安装。CLI多JD文件跨进程上传checkpoint仍待补齐，单简历multipart幂等已实测。

## 5. 当前在调查与后续完整任务

1. 邮件：官方ImapMessageParserService fetchAll(source:true)已经拿完整EML并PostalMime.parse；buildMessage只保留去引文text、附件名与headers，原始bytes/HTML/附件内容未进入原生message。需要在仍有source时接受控完整归档（账号、folder、uidValidity/UID、Message-ID、text/html、全部附件/inline），绑定原连接owner当前权限，接统一intake。原生MessagingGetMessagesService转发provider；不要另建解析链、启用批量历史同步或发送邮件。尚无新实收验收。
2. 草稿已有，人工跟进/联系/推荐/发布回执仍需后端+UI+MCP/CLI；实际动作需要直接用户会话确认，不能把复制/模型结果当发送。公司分享要接候选人门户的真实同意，不猜CRM原字段。
3. 门户资料/附件/意向/分享确认及撤回。数据库person.candidatePortalState在全部970行（含softdeleted）均null；当前checkout旧repo未找到门户源实现，不能宣称已恢复。需要明确capability链接与绑定访问、上传仅入指定候选人，撤回后不再授权分享。原candidatePortalProfile/Link等字段保留。
4. 长材料：补真实长页图与中文扫描、损坏/加密/多格式回归。Jev当前UTF8 bytes保守预算不是精确token计量，8个长候选人仍review；不得静默截断或冒充已评分。
5. 评测RS(I)：旧30×46/1380cache都是已见，22/8非unseen；独立raw材料盲审silver、固定holdout、能力/意向分开对照，输出约束违规/unknown误拒/保真/前五/覆盖/费用/延迟。Embedding只可选对照，不必经。
6. 完整内置订阅管理，原生官方Agent默认选模和tools/流真实验证；SIWC本人授权缺失如实标未验收，现有只读source可继续用。
7. 合同兼容盘点：旧twenty-contracts是固定RPO模板→法大大autoStart:false草稿→负责人手动编辑发起/确认状态，尚无真实平台配置/模板且旧用户明确不要沙箱签约测试。保留company.contractDetails/DraftId/Preparation/Status及原native数据，必要原行为和阻塞说明，不能自造电子签/外发。
8. UI视觉与运营完整交互、需求与数据链路HTML、启动/停止/迁移/回退/证据文档；个人飞书若授权可用写personal文档，不发消息/不发布网站。

完整范围以DELIVERY_GOAL为准。未完成项不能为结束任务勾选完成。恢复后直接继续有独立进展的工作，不停在状态总结。

## 最新邮件归档检查点（覆盖上面的旧进程号）

- 详读MAIL_SOURCES.md与PROGRESS最后一节。邮件归档/选择/统一入库已经实现并实测，不重做；原生IMAP事件与受控实收尚未接。
- 当前API16，session86569/PID22596；worker12，session64658/PID22607；metadata2/PID22242已停止。最新快速重复回执修正尚未重启，API16是该修正前版本。
- 归档f2c854b0-0bf5-5fc1-979a-2440dced6e04；intake ead17ffe-3cf0-572f-b4d3-56995621ee0e完成；6个artifact下载SHA一致，包含inline；expectedRoles后端工程师，独立匹配59d966ea-cef7-53be-a47d-dc10474559b7。没有额外candidate。11项邮件/权限测试通过。
- 新recruitingMailArchive与MailEvent的对象/字段已由官方metadata创建，deferred indexes已完成，两个内部表导航已隐藏。MailUploadService新增fromMailArchive，只允许从可读且签名通过的父记录重绑其artifact，不允许任意fileID。
- 下一步：原生ImapMessageParser结果保留rawSource→GetMessages边界发受控source事件→绑定原connected account owner的捕获配置；先验单封收取，不开启旧历史同步/工作流，不发邮件。目标需要邮件UI和MCP/CLI。默认capture关闭，不能凭workspaceID升为system身份。
- 其余完整目标仍按上面第5节和DELIVERY_GOAL执行，不停在归档API。

## 2026-11-01 05:30 最新恢复点

- 最新commits：76ef1329完整MIME归档，dcf9b6c6邮件MCP/CLI，422bc220邮件UI，458f60de原生IMAP事件，c8c6613d本人邮箱/单封只读，17e37602连接UI，a9569e4c独立锁池，efc8a420姓名与技能保真。
- 本人IMAP连接1个已真实只读最新一封，archive9719d751-6805-5477-86d4-12ead6b69719，6份资源、原文SHA正确、0intake；捕获配置已实际开/关往返并最终关闭。原生协议入口true，所有messageChannel自动同步0、旧ACTIVEworkflow0、cron关、只启招聘两worker队列。不要再说未连接过真实邮箱，也不要说后台同步已运行。
- 新Mailbox.enableTime边界按服务器INTERNALDATE阻止原生历史回放变成新投递，8项测试通过；默认捕获关闭。UI与APIkey403证明所有者隔离，未浏览器验收。cookie opt-in JSON/下载实测200，无opt-in403。
- 独立recruiting-locks池18连接复用官方PostgresAdvisoryLockService，避免core默认10被长任务锁占满；真实18锁+仅2普通查询连接全完成48ms。所有锁消费者已注入，API19已实际启动；新模块禁DDL/实体/迁移，Nest管理关闭。
- 用户命名Li/An/He/Go会误删Linux/Angular/Helm等的原全局替换已修，仅明确姓名头处理；11项输入回归通过。sourceCode已commit，但API20仍旧minimizer，下一build会更新。
- 目前正在build：session88188已是旧完成；最新match-window-build.log对应exec session稍后从tool状态取。API20/PID26729、worker16/PID26740已核对cwd并SIGTERM，当前应无API/worker监听，等构建真正完成再启动，日志建议api21/worker17。
- 当前未提交新匹配修正：公司PAUSED/CLOSED先排除，未知公司状态仍保留；相关公司变更触发队列。能力问题未改，abilityCacheNamespace保留历史值以复用付费分数；整体协议标记context-v2/eligibility-v3。新run存protocolVersion，执行/重试会写本轮版本，旧未记录的返回legacy/unrecorded。
- 另修错误窗口检查：原32k UTF8字节并非32k token，误拒8位。改为1MB传输上限、不截断，真正token上下文由Jev服务端检查；实际上下文拒绝变NEEDS_REVIEW，不当0，不泄漏provider body。51项原重点测试已通过；新增完整中文长文与服务端拒绝测试正在match-window-tests-2（需看最终日志），TS/lint日志见match-window-*。
- 官方docs live确认https://docs.typesafe.ai/models默认64k/request/32k/question，单位token；未启用Danger-Zone长上下文。别用豆包/tiktoken冒充Jev精确tokenizer。8个旧误拒candidate IDs可从93166da1...的results中error LIKE上下文读出，已在tool输出；需要在新运行版本下对原fixtureJD发限定反向run实际测，复用其他缓存。
- 原reverse旧77review仍是老证据；当前还有输入源增补、正式RSI独立holdout评测、门户资料/附件/意向/分享/撤回、人工跟进/发布回执、完整SIWC管理/nativeAgent/tools、合同兼容盘点、数据链路HTML/交付/个人Feishu文档。不要停下或缩范围。
- 下一步先接续新build、跑8位原窗口拒绝的真实Jev，提交匹配修正，再尽快完成剩余业务。精简分析，多实际执行；不要反复空转扩大可选范围。Ego恢复许可仍未回复，不得创建新TaskSpace或绕其他浏览器验收。
