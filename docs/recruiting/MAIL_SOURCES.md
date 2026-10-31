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

本地已用本人已有连接完成一次真实单封读取：6份原件/资源，EML下载摘要一致，保持待选择且没有生成候选人。原生协议入口为本地验证重新启用，自动同步、旧工作流与相关旧队列保持关闭。持续原生自动收信未启用，不将单封读取说成后台同步已运行。本人连接UI已接入，页面仍待浏览器验收。
