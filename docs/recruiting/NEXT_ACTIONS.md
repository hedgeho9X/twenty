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

## 2026-11-01 06:21 最新恢复点

- HEAD新提交8c117449非简历审核，f8647540门户/同意/人工回执后端，dc3ca70b公共门户及原生工作台UI，另有刚提交native Agent viaApplication权限修复。DELIVERY_GOAL范围不变，仍active，不能complete。
- API27/session14090/PID33914、worker22/session20375/PID33926（以日志核实），临时AI-only worker2/session16650/PID33937。三个都来自本checkout；常驻worker仍只有招聘两队列，临时ai-queue启动前全状态0。结束验收需停临时AIworker；不要启动其他queue。
- 门户HTTP与简历上传/入库、分享撤回、重新确认旧链接不复活、源入口撤销均已实测；见PORTAL.md和PROGRESS。ad90cc91...合成入库COMPLETED/STORED关联原fixture；7e7f6832...明显JD误投材料进入MATERIAL_REVIEW，无覆盖。空JSON映射被原生存储删除导致MAC失配已修。
- NOTE可Agent写，实际联系/推荐/发布仅直接本人；新签名回执抵抗普通CRUD改后伪确认，历史记录保留待核对。MCP/CLI备注与门户查询真实成功，Key实际联系403、未同意推荐403。界面未浏览器QA，Ego恢复许可仍未收到，不能新开TaskSpace绕过。
- 官方runAgent文本与平面object通过，原生learn_tools→execute_tool已真实成功（thread615c28e4...输出1、tool success=true）。只读公司角色60b0f2d9...，native验收Agent d9391784...，无triggers。native JSON输出仅顶层primitive，复杂profile提取已有独立AI SDK链，别改官方约束冒充完整JSONSchema。
- 已新增ops/recruiting/prepare-rsi.mjs并执行成功，尚未commit；8位candidate按hash抽样，旧30、69输入调参样本、8窗口case及fixture排除，4dev+4holdout固定后没有看标签。46真岗位沿用冻结ID但后续需读取当前JD/公司版本。manifest .local/recruiting/evaluations/rsi-v1/manifest.json，hash1c6712cb449c46f309ef52498138f4daf57be736c0707758f61ed1389845cc32。
- 8位全部原件已通过本人nativeURL授权下载并Docling解析，9份文件、18页（其中1TXT无截图），全部complete。source.json含原生签名URL与PII，仅私有600文件，不打印/提交。materials.json包含requestId、sha、完整text/全部页面名。只打印aggregate，不查看holdout文本调参。
- 下一步提交8个candidate→46真岗位匹配，固定targetIds/idempotency，复用cache。blind judge使用独立无工具Agent，只给原件解析文字+随机打乱的Jev前五及2hash对照JD，不提供Jev分数/排名。先freeze判定prompt/schema，机器silver不是human gold，样本选择偏差不能称全库召回。输出能力/意向/硬约束/unknown/证据保真/前五可沟通率/一致性/成本延迟，dev/holdout分别报告，不看holdout后继续调参还称unseen。
- 仍未完成完整SIWC连接管理/刷新UI、全格式长图扫描损坏回归、合同兼容、HTML链路与飞书需求/交付、浏览器验收。继续独立工作，不缩目标，不停在总结。

## 2026-11-01 06:33 最新恢复点

- 关键新commits：c6f3ecf6修复原生Agent本地图片，2d13e886冻结独立原件评测样本，502cd677冻结盲评与报告，最新SIWC纯协议模块见git log（已commit）。HEAD之前8c600539已修nativeAgent viaApplication角色交集；旧门户和回执已commit。
- 当前API28/session65369/PID35217，worker23/session61164/PID35228，均本checkout。临时AI-only worker3/PID35239已在验收后SIGTERM；无ai-queue worker正在运行。B前端仍Vite23000/parser23003。新SIWC协议纯模块尚未注册DI，不影响现有运行。
- 原生图片真实失败根因：把localhost私有URL交上游下载407。现在RunAgentAttachmentService对验证过的本工作区AgentChat UPLOADED图片读FileService字节，20MB/图50MB总量，真实读取再次限量。原生runAgent识别96px合成绿色成功。12项附件/消息测试、TS/lint通过。材料Extractor本来直接字节不受该旧链影响。
- RSI第一轮已完成，8人×46真岗368score/0fail，Jev实际费用0.108646524USD、2,586,822输入tokens、6256输出。9原件18页全部parser complete（不等于OCR人工合格）。盲评8人56对：前五38/40值得沟通，调优/保留各19/20；非平局排序124/130一致，MAE.423。自由文本引用仅12/54逐字相符，不能信作证据或Jev理由。详见docs/recruiting/EVALUATION.md与私有report.json。
- 保留组唯一机器硬冲突是“偏好远程vs线下”；原件只写岗位类型远程，未明确拒线下，pipeline正确列needs_confirmation。原始silver不改，另存audit-decisions.json，非human gold。没有程序排除观测，误拒率unknown非0。看过这轮结果后，8人未来只能叫回归集，不能再称新holdout。
- 评测代码prepare-rsi/run-rsi-matches/judge-rsi/report-rsi.mjs已commit并真实跑过。judge Agent无角色/工具/触发器，仅内置引擎finalize；任务输入slot打乱、不含Jev分数/排名，文本原件全部传入，截图未输入本轮judge，必须明确限制。私有nativeAgent tokens尚可从agentTurn按8个silver.threadId聚合；报告不能把内部0credits当订阅免费。尚需评测HTML与必要更明确回归验收。
- SIWC已新读并核对官方：https://developers.openai.com/siwc/token-sharing-open-source/sign-in，profiles-and-sessions，models-and-inference，token-reference，https://auth.openai.com/.well-known/openid-configuration。重要：开源公共客户端首次client_id=dynamic_agent_client+agent_name_hint Twenty Recruiting+稳定ext_agent_host_id，回调返回issued oaiapp_...才用来exchange，无clientsecret。127.0.0.1随机端口/auth/callback，state+nonce+PKCE。scope openid profile email offline_access resource.invoke chatgpt.tokens.use.direct，resource https://api.openai.com/v1；SIWC只公共Responses/models，Codex保持另一协议。
- 新src/engine/core-modules/chatgpt-subscription/siwc-protocol.ts为纯可注入transport类，使用现有直接依赖jsonwebtoken9.0.2+Node createPublicKey JWK，RS256严格issuer/aud/exp/iat/nonce/optional at_hash。官方discovery已实时验证RS256和exact endpoints。JWKS5min缓存陌生kid重取；refresh不带scope保留grant；list visibility=list；revoke调用发现revocation_endpoint。9项合成测试及TS/lint过，尚无新SIWC真实授权。
- 下一步必须完成SIWC加密存储/loopback登录管理/跨进程刷新单飞/管理员设置UI/Provider接入，不能仅纯协议停工。现有SDKfactory仍只loadLocalCodexCredential（只读原auth.json，不复制不刷新），应加subscriptionConnectionId区分新SIWC连接并保留旧localfallback。官方SecretEncryptionService.encryptVersioned/decryptVersionedOrThrow使用AESGCM原生密钥；连接放私有700/600目录，加密所有Token，原子写替换整套tokens。Native PostgresAdvisoryLockService由TypeORMModule导出，可串行同connection刷新。API/worker同一目录、同secret。
- SIWC模块计划：store.service加密连接与refresh；login.service临时127.0.0.1 listener/stateowner/10min单次尝试；controller JWT仅本人superadmin（AdminPanelGuard仅支持GraphQL，REST需自己检查userIsFullAdmin+无impersonation+AuthPrincipalGuard仅standarduser）；AiModelsModule导入新模块并SDKfactory注入store。新授权本人最后操作，当前睡觉不启动授权、不弹浏览器。
- 纯协议helper支持初始/已注册client重登、注册返回必须issued ID、identity-onlygrant与plan permission分开；新授权不能替换旧活动账号直到验证身份；refresh如果id_token有返回要验证同sub，缺省可保留原tokenhint；若无refresh或plan scope，不得当可用模型连接。退出按发现endpoint先revoke refresh，再清本地，失败明确remoteRevocationConfirmed=false。retainclient/accountmapping与hostId；不修改Codex原登录。
- 官方模型管理前端SettingsAdminAI.tsx，provider schema AiProviderConfig+subscriptionAccountId已有，authType=chatgpt已有；当前publicSIWC连接UI未做。models catalog按账号，不猜5.6/6.1名。oauthURL不带id_token_hint以免ID token回到前端JS，允许账户选择器。
- 仍未做：SIWC完整以上、全格式长图中文扫描损坏/加密回归、合同必要兼容盘点/可用入口、数据链路HTML与交付文档/个人飞书需求、实际UI浏览器验收。Ego恢复许可未收到，不能新建TaskSpace或绕浏览器。不要停止或缩目标，全部完成前goal保持active。


## 2026-11-01 07:47 最新恢复点（覆盖上面所有旧进程和待办）

- 先读DELIVERY_GOAL.md、PROGRESS.md顶部与07:45节、RUNBOOK.md。唯一仓库/分支/边界不变，整体未完成，native goal active。不要重做已经有证据的实现或扩大目标，也不要为制造进展反复付费跑旧实验。
- 最新代码commit：461803bd邮箱持久新邮件poll；06cfad8a实际Shadcn组件；0b32f322离线表格与数据链路；a6c26d19公开AI-only启动器和合同Agent说明；a696de6a CLI跨进程JD上传恢复；e3530ea6 CSV防护；4e1eea44旧DOC回归；0c3fb5bf交付运行说明。后续文档提交以git log为准。所有仅本地commit，没有push/Issue/PR/生产或外发。
- 当前API34/session58969/PID41435，招聘worker28/session56030/PID41446；AI-only worker4/session84811/PID42530现已保留运行，让本地普通原生Agent可用。Vite/PID11915，parser23003。重启前先lsof/ps/cwd，不使用旧PID盲kill；新增公开命令node ops/recruiting/local.mjs ai-worker仅ai-queue，持久主worker仍只有招聘两队列，旧cron/工作流/发送队列不启。
- 最后服务端build是mail-poll-build.log，API34包含当前所有服务端改动，后续只是CLI、HTML、测试和文档，无需重建服务端。两包TS/lint通过；29套162项招聘/订阅Jest+15项CLI/上传恢复/缓存测试通过；不要无变化重复全套测试。
- 邮件poll已实现并真实空轮询通过，合成新UID/失败/去重/超限/UIDVALIDITY变化13tests。本人连接最终enabled=false，autoSubmit恢复true，原生sync0。不可称已收到自然新邮件；不自行发送测试邮件。详见MAIL_SOURCES.md和私有mail-poll-evidence.json。
- CLI jobs submit明确--key时用700/600本地checkpoint，按实例/凭据/key隔离。默认~/.cache/twenty-recruiting，可用TWENTY_CLI_STATE_DIR。无原材料/API Key，包含短时上传能力。原子immutable slot选同一引用，输入变化先拒，重跑查当前服务器权限。真实intake86069667-3a0c-5a7f-987e-39eb85b8c7e8同ID同file，到AWAITING_CONFIRMATION、1preview，未建新岗位；私有cli-recovery-test/evidence.json。不用为测重试重新制造候选人。
- Shadcn表格私有.local/recruiting/evaluations/rsi-v1/report.html已离线打包（约327KB），56rows、筛7、排序、恢复、CSV BOM/换行/防公式DOM通过。sources在ops/recruiting/report-ui，独立npm锁及MIT许可，node_modules是指向私有依赖的忽略symlink。重建node ops/recruiting/report-ui/build.mjs，不调用模型。通用docs/recruiting/data-flow.html有9点击节点，无PII。仍未做视觉QA，不能换浏览器绕过Ego。
- RSI初审原生tokens已核实95457输入/36691输出/cache0；不等于美元/免费。368Jev对原费用0.108646524USD，56机器silver不是human gold；原输入preview-v1不回写，8人看过结果后只能回归集。无需重跑收费。
- preview-v2旧DOC刚补真实HTTP：真OLE二进制、2页、2PNG、尾段文字、all_pages/complete。旧9项加此单项全部按预期通过，生成器与smoke已纳入DOC。详见PARSER_VALIDATION.md，原件结果私有doc-v2-evidence.json。
- 个人飞书文档已personal用户创建并精准更新、回读：https://my.feishu.cn/docx/H0sld6jFuosjIMxd1TWc4PcanPb 。CLI身份已正常，不需要重新扫码。lark-created-document.json和lark-document-final-check.json私有。后续只更新自己这份文档，不修改对方原文，不发IM。最新文档内容已写HTML/测试完成。
- 最新delivery-health.json：54company/171job/926people/498candidate（原基线53/166/925/497，其余合成fixture），各队列waiting/active/delayed0、3个worker，原生mail/calendar0、ACTIVEworkflow0、招聘mailbox enabled0。前端/API/parser200；Vite绝对fs私有路径403，相对/.local路径200为SPA HTML而非JSON。匹配queue留1条03:04权限失败，已审计同run03:08COMPLETED/46score/4excluded/0fail；当前50对资料陈旧且池变化，不返回旧排名。未删历史failedjob也没为清零重跑。
- 接下来只能推进有新证据的验收：专用Ego TaskSpace14丢失，之前恢复许可未答。skill及CLIguide规定整个目标只能一个space，不能新建恢复、不能claim他人space/换CUA/Chrome/Playwright绕过。需本人允许恢复空间后再实际逐页QA；此前inventory无14，别反复查无变化。已完成DOM测试不当浏览器验收。
- 新SIWC连接数0，所有管理/加密/rotation/真实loopback离线测完；仍需本人Continue with ChatGPT后新token的真实调用/刷新/失效。旧只读Codex来源文本/图/object/nativeAgent/tool真过；不碰原登录/keychain，不生成新授权链接让睡觉用户再过期。
- 另需要自然新邮件实收观测、业务方解析/匹配质量核对；外部FDD无配置，合同已保留五字段/提醒/手动确认并真MCP/CLI过，不能称外部签约集成完成。
- 已完成可独立推进的代码、接口、实验、HTML和交付文档。不要将整个目标标complete；没有新本人输入时不能用空转或反复测试冒充进展。阻塞状态需遵循native goal的连续3目标轮次规则；本次才结束长执行轮，不能把自动压缩次数当作目标轮次数。
