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

当前尚未接原生IMAP事件，也没有实际连接邮箱收取新邮件。邮箱同步仍关闭，不将EML上传验收说成实收验收。邮件选择页面、Agent邮件命令、原生接收设置和受控实收继续实现；不批量重放旧邮件，不发送邮件。
