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

改服务端后，先停止当前API及两个worker，运行node ops/recruiting/build-source.mjs twenty-server build，成功后再启动；该构建会重建dist，不能边构建边启动。共享包变更时运行完整local.mjs build。依赖使用固定.yarn/releases/yarn-4.18.1.cjs；本地Nx发现曾阻塞，build-source按官方project.json目标直接执行。

停止时在对应终端按Ctrl+C。后台运行时先用lsof和ps核对端口、PID与cwd，只向本仓库进程发送SIGTERM。最后local.mjs down停止本Compose项目并保留卷；不要使用全局Docker停止、删除卷或误停fanhan-local、AirJelly及Supabase容器。

截至2026-11-01 07:37，API34、招聘worker28和AI-only worker4已启动，前端仍由Vite运行。进程号只适合当时核对，不能作为以后的停止依据。私有logs保存对应日志。AI队列启动前waiting/active/delayed/prioritized/failed/paused均0、无scheduler；旧工作流和发送队列未启动。

## 3. 实习生操作顺序

1. 在运营工作台“公司与岗位”搜索公司，必要时就地新建，填写公司简介及招聘偏好。
2. 绑定公司，粘贴或上传多份JD并加说明。等待预览后逐项修正、忽略或确认，保留稳定itemId；只重试失败项。
3. 在候选人上传处放入简历及可选自述。补充已有候选人时明确选择目标，新的结构化职业资料以本次完整材料为准，原件及人工偏好保留。
4. 打开队列短弹窗看阶段、错误、重试及记录链接。材料类型错误、损坏或不完整时先核对，不把受理当入库成功。
5. 在待查看结果核对能力、意向、明确冲突、未知条件和覆盖量。可在两种方向或指定人岗重新尝试，最多前五；失败不算0分。
6. 生成问候/发布草稿后由人编辑核对；候选人确认分享后才给公司当前资料入口，撤回后访问失效。联系、推荐和发布须本人记录，系统不代发。
7. 公司合同保留五字段、内部提醒及负责人确认。当前未连接签约平台，内部任务不等于外部合同。

这些页面已实现并通过类型检查，仍需实际浏览器逐步验收。不要把本操作说明当成视觉验收记录。

## 4. 邮件接入

本人在个人设置维护原生IMAP连接。招聘收信默认关闭；可以先“只读最新一封”检查完整归档，再明确开启新邮件接入。开启建立当前INBOX UID基线，之后约每分钟只读检查；不补拉此前历史或关闭期间邮件。重新开启重新建基线。

原文、正文、HTML、headers、地址、所有附件及inline资源先完整归档。自动选材不确定时保持待人工选择；可补充说明及已有候选人目标。API Key与Agent可以导入EML，但不能管理、读取或冒用本人的邮箱连接。超50MB、缺稳定日期或UID基线变化会报错；后者自动停收，须本人核对后重开。

已真实验证单封归档的6份资源、原文SHA和定时空轮询，最终自动接入关闭。尚未观测自然到达的新邮件；需要本人实际投递一封后核对归档、选择、入库全链。没有发送测试邮件或修改已读状态。

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

## 8. 验收证据与待办

本地重点回归：29套/162项招聘及订阅Jest测试，15项CLI/上传恢复/缓存回放测试通过；前后端TS与相关lint通过。原生IMAP边界、原生Agent权限及附件还有各自已通过的专项测试。解析中文扫描、双栏、Word、长HTML/Markdown、外部资源、损坏和加密有真实HTTP记录，preview-v2保留所有内容层。

07:43健康核对：54公司、171岗位、926联系人（498候选人），比迁移基线多的是合成验收fixture；三队列均无等待/执行/延迟任务。匹配队列保留1条历史权限失败（03:04），其业务run在03:08已完成46评分/4排除/0业务失败，后续资料/池变化正确标为陈旧。未删除历史失败或为清零而重新付费；需要最新结果时选择当前资料发起新的有界任务。

匹配实验见EVALUATION.md，私有HTML为.local/recruiting/evaluations/rsi-v1/report.html。它用真实Shadcn源码离线打包，支持筛选、排序及CSV；不是Twenty产品组件替换。通用交互链路为data-flow.html。第一轮368对Jev评分及56对机器盲评已完成，机器一致性不是人工招聘准确率，后续需要业务方核对。

个人飞书文档：https://my.feishu.cn/docx/H0sld6jFuosjIMxd1TWc4PcanPb 。已用personal用户身份创建并回读确认标题和三章结构，没有写入个人简历、密钥或下载凭据。

未完成：专用浏览器任务空间恢复后对所有页面/门户做实际QA；本人新SIWC授权及真实刷新；自然新邮件到达后的端到端观测；业务方解析与匹配质量确认。外部签约没有配置，不算已交付外部平台集成。权威目标与剩余状态见DELIVERY_GOAL.md，整个目标仍active。
