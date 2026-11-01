# 邮件来源与完整材料

## 1. 原生获取链路

官方 MessagingGetMessagesService 按 connected account provider 转发。IMAP 使用已有 ImapClientProvider 读取加密连接配置，通过 ImapFlow 获取文件夹锁与 UIDVALIDITY，按 UID fetchAll 的 source:true 取得完整RFC822，再用PostalMime解析。

原生 buildMessage 保存去除引用历史后的text、主题、参与人、headers及附件名称。这里的附件名称不是文件内容，也没有持久化完整EML/HTML。完整招聘归档应接在原文仍可用的接收边界，复用原生连接、原连接owner与当前权限，不通过管理员Token另拉一套邮箱。

## 2. 已实现的完整归档

- POST mail-archives/upload 接收完整EML，不连接邮箱；原文先经原生上传生命周期保存，再由招聘队列展开MIME。GET列表/详情、retry和artifacts下载均校验当前父归档记录权限。
- 原文、完整text（含历史引用）、HTML、完整headers与地址、普通附件、内嵌资源全部归档。每份材料有来源摘要；不执行HTML、不加载外链。下载强制attachment及nosniff。原始EML是原始字节的权威副本；单个文件仍服从原生MIME处理规则。
- 每项上传后checkpoint，失败后保留EML与已完成文件，重试只补缺项。超过展开上限保留原文并明确失败，不冒充完整展开。
- IMAP事件身份使用account+folder+UIDVALIDITY+UID，忽略可变flags；相同事件遇到不同原文字节会冲突待核对。原文SHA256负责跨重复投递的归档去重；材料选择摘要负责候选人入库幂等，不能只依赖Message-ID。
- POST mail-archives/:id/intakes 选择简历/补充材料并填写可选说明，正文加入材料，EML/metadata作为归档引用。通过已鉴权父归档重新签发材料提交凭据，再调用既有intake服务，不接受任意fileId。内嵌图默认不当简历，但完整保留且允许手动选择。

## 3. 验证与剩余范围

合成EML真实上传、展开、下载6份原件与资源，各摘要相符；重复归档、重复选择复用相同ID。简历TXT和完整自我介绍进入原解析/结构化队列，写入已有合成候选人，expectedRoles提取后端工程师，并产生独立匹配任务。测试涵盖两个去重层、UID原文冲突、MIME中断恢复、内嵌图保留及父记录授权。

邮件选择页面已接入：完整正文查看、所有原件下载、简历/内嵌材料选择、可选说明、关联已有候选人和处理队列；未经过浏览器视觉验收。MCP的mail_import/mail_select及kind=mail任务接口、CLI的mail import/select均共用归档与intake服务，已真实回读和复用相同归档/入库任务。

## 4. 原生连接与真实单封验证

原生IMAP在CRM投影前发出awaited原文事件。招聘消费者只处理本人明确启用的连接，并重验当前owner身份和原生权限；Key/应用/Agent委托不能冒用邮箱所有者。启用时记录接收时间边界，来自原生历史回放且INTERNALDATE早于边界的邮件不进入招聘自动处理；缺稳定接收时间不猜成新邮件。

GET mailboxes仅列本人原生IMAP摘要；configure记录接入/自动整理选择，不开启原生同步；receive-latest使用原生ImapClientProvider，以只读锁取得最新UID、先查大小、再按该UID读取完整source，随后关闭连接并归档。没有发送、移动、修改flags或同步游标的代码路径。

本地已用本人已有连接完成一次真实单封读取：6份原件/资源，EML下载摘要一致，保持待选择且没有生成候选人。原生协议入口为本地验证重新启用，自动同步、旧工作流与相关旧队列保持关闭。本人连接UI已接入，页面仍待浏览器验收。

## 5. 后续新邮件的持久定时检查

本人开启接入时，先只读选取INBOX的UIDNEXT/UIDVALIDITY作为基线，不下载旧邮件。随后在现有recruiting-queue注册每分钟的持久BullMQ timer；API和worker重启不依赖内存计时器。每次重新核对当前owner、权限、接入开关和连接，最多检查10封新UID。默认按完整归档及自动选材服务受理，不另建解析链；界面显示最近检查与可读错误。

归档接受成功后才推进招聘自己的UID进度；失败保留该UID供下一次重试，超50MB不下载或截断。原生同步游标、已读标志、文件夹及SMTP保持原样。UIDVALIDITY改变会关闭接入并提示本人核对，不能静默重放不同邮箱。设置与读取共用原生PG互斥，关闭时移除timer；已经排队的任务仍须先检查开关。重新开启建立新的基线，不补拉关闭期间邮件；需要补充时使用单封读取或EML导入。

2026-11-01真实本人连接已完成开启（autoSubmit=false）→基线→worker定时检查→关闭→恢复原autoSubmit，人员记录数未变、原生邮件同步0、旧ACTIVE工作流0。没有自然新邮件到达的观测，不能将该空轮询说成新真人投递验收。合成新UID归档、重复范围、归档失败进度、超大邮件、基线变化与timer注册失败共13项测试通过；两包TS/lint通过。私有证据mail-poll-evidence.json，最终enabled=false。

## 6. 接收、恢复与权限时效

接收入队移到归档锁释放之后，避免worker立即领取时碰锁却伪成功。worker碰锁会抛可重试冲突，原生队列最多6次指数退避，5秒起、共7次尝试；业务失败仍保存原件与checkpoint。材料选项先规范排序，反向选择同一组文件复用相同输入与任务。

后台每次附件I/O后保存checkpoint、完成状态或错误状态前重查当前执行身份；失效直接停止，不用旧权限写FAILED。恢复操作在同一归档锁内检查in-flight，活跃任务不覆盖checkpoint；停止后可由有权限的新调用者重绑并恢复，锁释放后再入队。相关邮件/草稿竞态和权限回归已通过；这些测试不证明自然新邮件已经到达。

## 7. 原生文件归属与容量验收（2026-11-01）

canonical 邮件资源现在绑定同一归档记录的九个原生 FILES 槽：`sourceFiles`、`sourceFiles2` 至 `sourceFiles9`，布局 v1 每槽60，总容量540，覆盖500附件加raw/metadata/text/HTML最多504项。全局原生60上限和临时文件、所属字段规则保持；各 intake 使用其自己的原生文件副本，不把一个永久 fileId 同时绑定给归档和多个 intake。九个字段和物理列已实际回读，该工作区 deferred action 独立核对为0行；元数据设置及回退边界见 `MAIL_FILE_FIELDS.md`。

3份现有、当前本人可见且签名有效的归档，连同18份资源，已通过带锁的 `MailService.ensureCanonicalOwnership` 完成原生 copy/bind迁移。原件及资源迁移前后共42次SHA256对比一致，0缺原文、0签名过滤、0错误；归档ID/sourceHash/sources/intakeIds不变，未删除旧文件、重新解析或重新入队。私有证据为 `mail-file-ownership-evidence-v1.json`，范围不扩张到当前权限看不到的归档。

真实正常worker处理了一封固定Message-ID/Date、含text/HTML和500个极小TXT附件的合成EML，得到504份artifacts，九槽分布为 `[60,60,60,60,60,60,60,60,24]`。所有canonical引用的原生字段分区、owner、永久与未删除标志均核对通过；原件SHA正确，容量邮件另做12份首尾/槽边界SHA抽样。小合成CV邮件的4份canonical资源全量SHA通过；同一简历加两种note分别产生不同intake，各保留4份raw/body/metadata/简历引用，与canonical及彼此没有fileId交叉，8份副本SHA全量通过。

重复选材仍返回相同intake与父归档key/fileId绑定，旧归档 `f2c854b0-0bf5-5fc1-979a-2440dced6e04` 使用原note仍返回旧 `ead17ffe-3cf0-572f-b4d3-56995621ee0e`。verifier进程的真实调用计数显示这些重复请求没有新增copy或排队；该计数范围明确为 verifier-process-only，不能外推为后台没有活动。完整证据为 `mail-file-ownership-smoke-v1.json`。

新邮件intake `51b6e6ea-a3e6-555f-9f8f-427aa6a1aa4c` 与 `d1d131fb-8a21-515b-825f-80aa9cc83e9e` 已另行通过本地GET回读为 `COMPLETED / STORED`，各4份文件，所选简历TXT和正文均为 `complete / text_only`，结构化模型为 `chatgpt-subscription/gpt-5.6-sol`。smoke使用external-native-worker模式，`parsingAcceptedOnly=true` 只限定验收脚本本身没有直接执行intake处理；后台实际解析/匹配的模型用量未测量，不能写成零模型或免费。

这些结果证明完整合成邮件和文件归属链路通过，仍没有自然新邮件到达的观测；不得将合成EML、旧单封读取或空轮询当作自然新投递验收。

## 8. 用户改定的本地协议验收

用户明确要求自行启动本地邮件服务后，已中止真实邮箱的有限观察并恢复原开关；该窗口9次正常轮询无新邮件，不能记为实收成功。本轮完成的是GreenMail SMTP新投递→Twenty原生IMAP定时任务→完整六资源归档→PDF两页与说明解析→候选人入库→46岗Jev匹配，非直接调用mail.receive或导入EML。

旧UID1未补拉，新UID2进入原生统一入口；相同原文经IMAP再次投递为UID3，原归档/intake/matchRun复用，未读标志保持。测试后两个邮箱招聘接入及原生历史同步均关闭，重复scheduler0。此本地端到端范围按用户最新要求满足邮件门槛，不外推为外部生产邮箱自然投递验收。具体ID、用量、原件摘要与复验命令见LOCAL_MAIL_TEST.md。
