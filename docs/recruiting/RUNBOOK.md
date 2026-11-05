# 本地招聘系统使用与维护

## 1. 当前入口

| 内容 | 位置 |
| --- | --- |
| 官方 fork | hedgeho9X/twenty，分支 codex/fanhan-local-rebuild |
| 官方基线 | c0ad263b35a734dbd2528bf82c5dd38d3b18dc1b，源码2.55.0 |
| 新环境 B | http://localhost:23000；API http://127.0.0.1:23001 |
| 新运营工作台 | http://localhost:23000/recruiting-workspace，需本地登录 |
| 原环境 A | http://localhost:13000，仅对照，保留原库和附件 |
| 文档解析 | http://127.0.0.1:23003/healthz，Docling2.145.0、preview-v2 |
| 数据与缓存 | OrbStack twenty-recruiting-db-1 / cache-1，端口25432 / 26379 |
| 开发目录 | /Users/jerry/code/personal/projects/twenty |

新环境已经迁入数据，不能再执行database-init、重新import或重置。登录沿用本地副本已有账户；私有session供本地验收脚本使用，不是给前端复制的登录凭据。

## 2. 启动和停止

仓库固定Node为26.12.1。本机可直接使用项目内.local/recruiting/runtime/node-v26.12.1-darwin-arm64/bin/node；下列node均指这一版本。在仓库根运行node ops/recruiting/local.mjs up，再运行parser-up启动已构建的解析器。首次创建的空环境才需要init及模型资源准备，当前环境无需重做。

API、前端与招聘worker分别在独立终端运行：node ops/recruiting/local.mjs api、front、worker。worker只处理recruiting-queue与recruiting-match-queue；材料并发10，匹配为2个run、每run最多3个评分请求。普通原生Agent聊天还需要node ops/recruiting/local.mjs ai-worker，它仅处理ai-queue，不修改持久队列允许列表或启用旧自动化。

显式设置RECRUITING_AUTO_MATCH_ENABLED=false时，候选人入库和岗位确认仍保存成功，但不自动安排匹配，回执记录matchingStatus=DISABLED；人工匹配接口仍可调用。当前B保持true。测试脚本自己的环境变量不能改变已经运行的API或worker，不能把局部queue spy当作后台实际用量统计。

改服务端后，先停止当前API及两个worker，运行node ops/recruiting/build-source.mjs twenty-server build，成功后再启动；该构建会重建dist，不能边构建边启动。共享包变更时运行完整local.mjs build。依赖使用固定.yarn/releases/yarn-4.18.1.cjs；本地Nx发现曾阻塞，build-source按官方project.json目标直接执行。

停止时在对应终端按Ctrl+C。后台运行时先用lsof和ps核对端口、PID与cwd，只向本仓库进程发送SIGTERM。最后local.mjs down停止本Compose项目并保留卷；不要使用全局Docker停止、删除卷或误停fanhan-local、AirJelly及Supabase容器。

当前API、招聘worker和AI-only worker由本仓库源码运行，前端由Vite运行。最新构建与进程核对见NEXT_ACTIONS.md；任何历史PID都不能直接作为停止依据。私有logs保存对应日志。AI队列初次启动前所有任务状态均0、无scheduler；旧工作流和发送队列未启动。

## 3. 实习生操作顺序

1. 在运营工作台“公司与岗位”搜索公司，必要时就地新建，填写公司简介及招聘偏好。
   搜索结果附带已保存的域名，用于区分同名公司。选中后可展开“已有岗位”核对当前权限可见的岗位总数、前5条及在招/停招状态，避免重复导入；完整记录仍通过原生公司/岗位链接查看。本轮补充的展示已通过组件与真实接口检查，浏览器验收待恢复控制后完成。
2. 选定公司后逐条填写JD文字和可选说明，可一次添加多条。每条独立提交到后台队列，自动解析并创建岗位；页面没有第三个确认步骤。处理失败或资料不足在队列中核对。

   返回选择公司时保留未提交文字；成功任务不因其他条目失败而重发。需要修订已入库岗位时打开其原生记录。
3. 在候选人上传处放入简历及可选自述。补充已有候选人时明确选择目标，新的结构化职业资料以本次完整材料为准，原件及人工偏好保留。
4. 打开队列短弹窗看阶段、错误、重试及记录链接。材料类型错误、损坏或不完整时先核对，不把受理当入库成功。
5. 在待查看结果核对能力、意向、明确冲突、未知条件和覆盖量。可在两种方向或指定人岗重新尝试，最多前五；失败不算0分。
   在“岗位与公司”列点击“查看公司资料”，按需读取当前公司简介与招聘偏好，保留原生公司链接。显示的是当前公司事实，资料变化后应刷新匹配；它不是Jev生成的解释。字段值只作为文字呈现，不执行HTML或加载其中的远程媒体，权限读取失败时不继续展示缓存内容。此新增展开面板的实际页面验收仍待完成。
6. 生成问候/发布草稿后由人编辑核对；候选人确认分享后才给公司当前资料入口，撤回后访问失效。联系、推荐和发布须本人记录，系统不代发。

当前已有真实页面上传、队列、候选人原生列表/详情/附件两页、匹配前五、指定人岗和问候草稿编辑的操作证据。公司/JD预览编辑和取消新建、合成邮件原文下载也已实测；逐项状态见UI_ACCEPTANCE.md。随后已补正常页面的新公司提交、两TXT批量JD最终确认与门户撤回闭环。新增展示和发布稿/跟进提交交互仍按UI_ACCEPTANCE.md逐项待验，不能沿用旧截图代证。

## 4. 邮件接入

本人在个人设置维护原生IMAP连接。招聘收信默认关闭；可以先“只读最新一封”检查完整归档，再明确开启新邮件接入。开启建立当前INBOX UID基线，之后约每分钟只读检查；不补拉此前历史或关闭期间邮件。重新开启重新建基线。

原文、正文、HTML、headers、地址、所有附件及inline资源先完整归档。自动选材不确定时保持待人工选择；可补充说明及已有候选人目标。API Key与Agent可以导入EML，但不能管理、读取或冒用本人的邮箱连接。超50MB、缺稳定日期或UID基线变化会报错；后者自动停收，须本人核对后重开。

已有真实业务连接单封读取及空轮询证据。用户现改为本地服务验收；GreenMail已在OrbStack运行，独立账号通过真实SMTP投递、Twenty原生定时IMAP接入、六资源归档、两页PDF入库及46岗匹配完成，旧邮件与重复投递边界通过。详见LOCAL_MAIL_TEST.md。外部业务邮箱自然来信不再是本轮必需门槛；本轮未对外发送或更改已读。

## 5. 模型和订阅

官方管理面板AI页管理Provider与模型。现有只读本机Codex来源使用实际目录发现的gpt-5.6-sol，文本、图片、对象、原生工具已实测；不要根据名称猜其他模型可用。

新SIWC连接在Twenty内完成loopback授权、加密存储和刷新，不新增代理服务。本人醒后进入AI设置，完成Continue with ChatGPT，选择该账户真实可用模型并添加，随后再选默认模型或Agent模型。连接成功不会自动切换默认档位；图片能力须单独核对。新SIWC真实授权、刷新及失效尚未验收，详见SUBSCRIPTIONS.md。

Jev独立用于固定人岗协议；Embedding独立配置，仅保留实验/未来召回用途。材料整理与草稿使用AI SDK结构化输出，原生Agent自己的平面responseFormat限制没有被改成任意JSON Schema。

## 6. Agent接口和恢复

HTTP /recruiting、原生/mcp的recruiting_operations、ops/recruiting/cli.mjs及.agents/skills/recruiting共用业务服务。凭据通过TWENTY_API_KEY环境变量，实例通过TWENTY_BASE_URL，命令参数和报告不放凭据。

先查公司，再提交JD、取预览、确认；简历通过上传授权→PUT→完成→提交。202只代表持久受理，保存intakeId/runId/draftId/archiveId继续查询。NEEDS_REVIEW、部分失败和无合适结果分别处理；不要改内部payload/result伪造进度。Key撤销、角色变化和后台任务执行都会重新核对权限。

已取得任务ID时优先task get/retry。CLI的JD多文件上传在明确传--key时保存本地checkpoint，重跑复用已完成文件或向服务器查询原任务。缓存按实例、凭据与提交标识隔离，默认位于~/.cache/twenty-recruiting，可由TWENTY_CLI_STATE_DIR指定；仅保留输入摘要、短时上传能力和任务ID，权限700/600，不保存API Key或原始材料。修改材料/说明必须换key；更换凭据不复用旧上传能力。已受理的服务器任务也可按ID恢复，单简历multipart同key可重发。详见AGENT_ACCESS.md。

## 7. 数据、版本和回退

.local/recruiting是Git忽略的私有目录，包含数据库导入dump、原件、parser输出、模型缓存、session、加密连接、配置及验收证据。Vite拒绝提供整个.local目录，不能为方便报告访问撤销这一限制。原件和业务报告只通过授权API或本地文件打开。

保留APP_SECRET、ENCRYPTION_KEY、RECRUITING_STATE_SIGNING_KEY等原值，API与worker必须一致。旋转或丢失会影响旧加密连接或内部记录MAC，不要通过删除签名/允许legacy sealing绕过。凭据不提交、不打印；SIWC文件额外使用AES-GCM及600/700权限。

代码回退先停止本仓库进程，在独立分支选择需要的本地commit；不硬重置用户未提交工作，不把新schema降级为旧版本。导航变更的原值保存在私有navigation-backup.json，configure-navigation.mjs --restore可恢复菜单。数据库回退应保留当前卷，复制到新的空目标验证；不在现有B或A上覆盖导入。

原迁移基线53公司、166岗位、925联系人（其中497候选人）、1206文件；后续合成验收会增加标记明确的fixture。全50业务表摘要在迁移时一致，附件全量大小一致、10份抽样SHA一致，不声称1206份全做了SHA核验。

本地曾缺官方agentChatThreadParticipant.mentionsResolvedAt字段，导致聊天摘要报CHAT_UPGRADE_IN_PROGRESS。已先只读确认元数据/物理列缺失及deferred0，再通过本仓库local.mjs command调用官方upgrade:2-54:add-chat-mention-resolution，始终明确--workspace-id 4cb349cd-5765-4826-a2cb-73e5c5c2d564，先--dry-run再执行。该命令只补nullable系统时间字段，同步原生DDL并失效缓存；现字段与物理列存在、metadataVersion184、原API聊天摘要成功。不要改guard、workspace版本或状态掩盖缺项，也不要把这一项当作整条升级序列完成。当前无需重复执行，证据为私有chat-mention-field-evidence.json。

## 8. 验收证据与待办

本地重点回归：08:07时31套183项服务端/订阅测试通过，随后邮件归属及自动匹配禁用的最终快照8套44项通过，前端4套35项通过；这些集合重叠，不能相加宣称总测试数。另有15项CLI/上传恢复/缓存回放，以及原生ORM文件零行更新的4套34项专项验证；前后端TS与相关lint通过。Parser最终11例真实HTTP符合预期：7例完整、1例外部资源待核对、3例损坏/加密422；真实旧DOC和Word表格两页及对应关系均有证据，preview-v2保留全部内容层。

07:43健康核对：54公司、171岗位、926联系人（498候选人），比迁移基线多的是合成验收fixture；三队列均无等待/执行/延迟任务。匹配队列保留1条历史权限失败（03:04），其业务run在03:08已完成46评分/4排除/0业务失败，后续资料/池变化正确标为陈旧。未删除历史失败或为清零而重新付费；需要最新结果时选择当前资料发起新的有界任务。

匹配实验见EVALUATION.md，私有HTML为.local/recruiting/evaluations/rsi-v1/report.html。它用真实Shadcn源码离线打包，支持筛选、排序及CSV；不是Twenty产品组件替换。通用交互链路为data-flow.html。第一轮368对Jev评分及56对机器盲评已完成，机器一致性不是人工招聘准确率，后续需要业务方核对。

10:15将六个经过ID、合成公司及验收来源确认的测试岗位通过原生API设为CLOSED，原始版本和状态已私存备份；没有删除原件或真实岗位。当前在招集合与RSI冻结的46个真实岗位完全一致。页面合成候选人的全池刷新46/46全部命中缓存、0失败；其最高分1.32/4只说明相对排序，不能说找到合适岗位。原52岗混合池证据单独保留，未改写成真实岗质量实验。

个人飞书文档：https://my.feishu.cn/docx/H0sld6jFuosjIMxd1TWc4PcanPb 。已用personal用户身份创建并回读确认标题和三章结构，没有写入个人简历、密钥或下载凭据。

原核心运营页面与门户闭环已通过。新增公司选择提示/已有岗位、匹配公司资料、JD预览来源/缺失/同名提示、材料下载及发布稿/跟进提交的完整剩余页面范围，见UI_ACCEPTANCE.md第7节及DELIVERY_AUDIT.md。另未完成本人新SIWC授权及真实刷新，以及业务方解析与匹配质量确认；本地SMTP/IMAP端到端已替代等待外部自然邮件并完成。专用Ego空间15已交用户，需本人确认后恢复控制。外部签约没有配置，不算已交付外部平台集成。权威目标与剩余状态见DELIVERY_GOAL.md，整个目标仍active。

10:49最终回读：55公司、174岗位、928联系人（500候选人），较迁移基线新增为合成测试记录；活跃池仍为冻结的46真岗，新增八个测试岗均CLOSED。三队列等待/执行/延迟/优先均0，原生邮件同步0、日历同步0、旧ACTIVE工作流0、deferred0、招聘收信开启数0。当前健康与运行回执私存delivery-health-final.json。

12:13完整审计：当前业务源码为API41/worker35/AI11，未因报告工具变更而无故重建。服务端招聘与订阅35套221项、前端招聘8套50项限定回归全通过；原件9/9哈希核对和人/岗联合分组缓存回放已补充，均不调用模型。原候选人分组实验与新事后回放分别保留，不宣称新未见测试。个人飞书revision14三章与需求回读一致。当前55公司/175岗位/929联系人/501候选人，46在招；原A、新B、parser200，三队列空闲/无scheduler，收信保持关闭，新SIWC连接0。121项审计索引及剩余门槛见DELIVERY_AUDIT.md，不以历史数据快照当当前数量。

2026-11-01最新范围调整：合同功能已按Jerry要求移除，包括工作台表单、内部提醒、HTTP、MCP及CLI入口；既有数据库合同字段和历史记录保留。历史审计中的合同能力与待验收项已不属于当前交付范围。


### 上传、重解析与匹配结果更新

正常生产环境应设置 `RECRUITING_AUTO_MATCH_ENABLED=true`，新简历解析保存完成后才自动安排匹配；显式关闭仅用于有计划的批处理或维护，并在维护完成后恢复。旧的“已入库·未匹配”回执不会因开关恢复而自动重放。

处理队列按已识别候选人展示最新上传记录，未识别或待核对材料分别保留；匹配状态关联该候选人最新的整组任务，独立手动匹配也能显示。原件和持久回执保留，列表合并不删除业务数据。

简历更新可使已经完成的评分失效。详情显示“评分已过期”，可点击“按最新资料重新匹配”；同一重试接口也用于CLI任务恢复，保留原来的指定目标范围，复用有效缓存。最终评分写入前再次核对来源版本，更新期间的任务不会被发布为有效完成。


### 文案与链接分别生成

生成沟通文案不会创建公开链接。分享前在确认框核对所选候选人、岗位名称及数量，并决定是否附带全部PDF/附件；确认后才创建链接。展开到十条后，“全选当前结果”选择全部十条。CLI 0.5.1及配套Skill采用同一流程：先确认明确ID范围，再单独调用share create。历史草稿与已创建链接保留，不因本次升级撤销。
