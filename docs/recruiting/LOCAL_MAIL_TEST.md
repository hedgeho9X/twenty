# 本地邮件服务与接入验收

## 1. 服务与边界

按2026-11-01用户要求，在OrbStack中启动独立GreenMail测试服务，使用SMTP投递合成邮件，再由Twenty的原生IMAP客户端及招聘定时任务接收。该路径不依赖真实业务邮箱自然来信，也不使用EML直接导入替代收信。

| 项目 | 当前配置 |
| --- | --- |
| 容器 | twenty-recruiting-mail-test-1，Compose可选mail-test profile |
| 固定镜像 | greenmail/standalone:2.1.15，digest 309ba544ea482e5d4265d09921cdab07c8dad2cc4481d715c9b8ff5d3f0a149f，已验证arm64 |
| SMTP | 127.0.0.1:23025 |
| IMAP | 127.0.0.1:23143 |
| 配置API | http://127.0.0.1:23080/api/configuration |
| Twenty测试连接 | recruiting-harness@recruiting.local.invalid |

GreenMail为本地开发测试邮件服务器，支持SMTP和IMAP且不向真实邮件服务器转发，见[官方说明](https://greenmail-mail-test.github.io/greenmail/)。端口仅发布到loopback。测试密码随机生成，保存在Git忽略的.local/recruiting/mail-test/account.json及server.env，权限600；不放入命令参数、报告或聊天。

原生saveImapSmtpCaldavAccount接口验证连接并加密存储IMAP凭据，未改动已有业务邮箱连接。测试连接的原生历史同步及联系人自动创建均通过原生updateMessageChannel关闭，仅使用招聘接入队列。B环境使用官方OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS精确允许127.0.0.1，未关闭安全模式或使用通配符。

## 2. 启动与状态

在仓库根使用RUNBOOK指定的Node版本：

- `node ops/recruiting/local-mail.mjs up`：仅启动可选mail-test服务，保留其他容器。首次增加本地允许地址时输出allowlistRequiresApiRestart=true，需重启本地API与worker加载配置。
- `node ops/recruiting/local-mail.mjs status`：检查SMTP、IMAP、配置API端口，并私存状态。
- `node ops/recruiting/local-mail.mjs down`：只停止本服务。GreenMail邮箱内容位于内存，停止/重建后不可假设原UIDVALIDITY仍相同；招聘归档及解析结果仍在Twenty数据库与文件存储中。

本次测试后GreenMail继续运行，两个邮箱的招聘自动接入均关闭，无待运行的重复定时器。原生邮件/日历同步和旧工作流仍为0。联调时通过正常设置为此测试账号开启招聘接入；旧业务邮箱保持原状态。

## 3. 真实协议端到端结果

验收运行11:22:41～11:24:43，发送端使用Python标准库SMTP/IMAP，应用端保持Twenty自己的ImapFlow客户端，避免测试调用内部接收函数。

1. 开启接入前经SMTP放入旧邮件UID1，再由原生接入建立INBOX基线。
2. 开启后经SMTP投递新邮件UID2，包含完整text、HTML、两页中文扫描PDF及inline PNG。
3. 正常RecruitingMailboxPollJob读取新UID，归档为5d7c0e94-5443-53a6-869c-1f5c286d603e，六份资源齐全，独立IMAP PEEK原文SHA与归档原件一致；正文历史引用标记保留。
4. 自动提交448f5f2c-fe82-5822-a6f7-d172c1f08920，Docling完成PDF两页、all_pages及邮件正文text_only；gpt-5.6-sol提取后端工程师意向并写入候选人b6b09df5-3bba-505e-84af-6b3a6d3e4f94。
5. 自动匹配cdc1ec42-73d0-588d-99c4-3fdc786f9829，46/46完成评分、0失败、0缓存、complete=true，展示前五。gateway上报cost字段合计0.006314952，订阅材料提取用量另计，不称零模型或免费。
6. 将已接收的同一RFC822原文经IMAP APPEND再次投递为UID3，接收侧新增来源别名并复用原归档、intake和matchRun，没有重复建人或重评分。旧UID1没有归档，独立客户端确认原邮件仍未读。
7. finally关闭测试接入。回读两连接enabled=false，三队列等待/执行/延迟/优先与重复scheduler均0，原生邮件/日历同步和旧ACTIVE工作流0。新增一位合成候选人后为929联系人/501候选人，不是重解析497位历史候选人。

私有证据位于.local/recruiting/mail-test：reception-evidence-v1.json、reception-supplement-v1.json、final-health-v1.json及原件。最初证据的materialPages汇总读错字段而为空；补充报告独立回读真实pages=2、coverage=all_pages，未重写原证据冒充新结果。

## 4. 复验与新的投递

`node ops/recruiting/smoke-local-mail.mjs`默认只回读已完成的原任务，验证当前仍可访问且匹配有效，实际已复验成功，新邮件/新模型请求为0；不会把旧报告称为本轮重新收信。

需要新端到端场景时显式加`--new-case`，程序保存上一轮状态，使用新的合成Message-ID和独立原件目录。该模式会新投递、创建合成资料并调用模型。若上一轮失败，应先按reception-state-v1.json中持久任务ID排查，不通过盲目重复投递掩盖故障。

原件及所有下载都通过既有鉴权服务，不公开.local目录。整个测试没有对外发送邮件、联系候选人、推荐给公司或发布内容。
