# 恢复执行入口

更新时间：2026-11-01 10:49，Asia/Shanghai。先读DELIVERY_GOAL.md与PROGRESS.md，再核对本文件和实时进程。完整目标仍active，未缩小范围。用户已经醒来，明确要求代理恢复本地登录；不得沿用旧的“浏览器恢复未获准”结论。

## 1. 固定底座和边界

- 唯一开发仓库 /Users/jerry/code/personal/projects/twenty，个人fork hedgeho9X/twenty，分支codex/fanhan-local-rebuild；官方base c0ad263b35a734dbd2528bf82c5dd38d3b18dc1b，源码2.55.0。
- 本地B：UI23000，API23001，parser23003，PG25432/recruiting，Valkey26379。保留A13000及所有fanhan-local-*。不碰无关AirJelly/Supabase；不push、Issue、PR、生产写入、发送或发布。
- 固定Node .local/recruiting/runtime/node-v26.12.1-darwin-arm64/bin/node。私有配置、会话、原件、截图、报告在.local/recruiting，Git忽略、Vite禁止提供；凭据不打印或提交。
- 最新developer要求并行子Agent，覆盖目标文件原有默认限制；已由三位代理审查，任务状态需用collaboration核对。

## 2. 运行版本

- 已运行API38，PID65513/session33051；招聘worker32，PID65514/session51380；AI-only worker8，PID65515/session76984；front11915。这些仅为恢复定位，停止前必须lsof/ps/cwd重新核对。
- 最新9604源码文件构建已加载邮件canonical ownership与96c9335d明确autoMatch=false修复；B保持true。55d7643e本地门户/订阅代理修复也已生效，正常页面可读。
- 10:30已完成idle后精确停止/构建/重启与健康核对，前端/API/parser200。今后只有新服务端变化才重复构建；只招聘两队列+ai-queue，无旧同步/工作流/发送队列或cron。
- .git写、精确SIGTERM及Ego操作需require_escalated；本地repo写与network本turn已经request_permissions授权。普通sandbox EPERM不等于自动审核拒绝。曾一条代理只读输出过宽遭审核拒绝，收窄为聚合及固定合成ID后已允许，无剩余阻塞。

## 3. 最新已验证的行为

- 页面合成PDF intake66c0d084-f0a6-5251-9c7c-48d379061ccd已STORED，person f351b421-4a46-5d10-ac58-88703a3000eb，原件两页可预览。模型chatgpt-subscription/gpt-5.6-sol，engineering/后端工程师/全职/远程。
- 自动run ac79abe7-2235-52fd-9fcc-0b784e38b6e7先52/52评分；之后六个固定合成岗位原生API设CLOSED，活跃池精确回到RSI冻结46真岗；retry46/46全缓存、0失败、complete=true，最高1.32/4，不当成找到合适岗位。原52证据不改写，新证据qa-browser-intake-real-pool-evidence.json。
- 合成岗位停招备份qa-fixture-jobs-retired-backup.json及聚合qa-fixture-jobs-retired-evidence.json，不按名称批量清理，不删记录。若重新运行旧smoke会把测试岗重新开在招，必须明确处理隔离再验收，不能盲重跑。
- 根p1完成实际手动指定人岗1/1、匹配带入草稿、清除关联岗位、真实问候草稿生成及编辑保存。没有批准或记录实际联系。子Agent p2完成原生候选人列表/详情/两页附件，公司/JD可取消编辑及合成邮件原文下载；最新UI逐项见UI_ACCEPTANCE.md。
- 解析最终11例符合预期：7完整、1外资源待核对、3损坏/加密422；中文扫描、旧DOC、Word表格对应关系及长HTML/MD均实测，外网请求0。没有重解析全部497历史候选人。
- 8人×46真岗368对Jev评分0失败；机器silver前五38/40、引用仅12/54逐字，非human gold、非95%招聘准确率；输入和旧preview-v1实验不可回写。私有Shadcn离线HTML及通用data-flow.html已生成。

## 4. 邮件生命周期与数据

- 九个sourceFiles原生FILES槽每槽60，物理列已存在；deferredWorkspaceMigrationAction该工作区0行。intake.files原60保留，person.candidateResumes8→30；未改全局60或owner。
- 当前本人可见3份旧签名归档、18份资源已原生copy/bind迁移，42次前后SHA比较通过。scope仍限定本人可见，不伪改report的workspaceWideCompleteness=false。
- 500附件合成邮件504 artifacts，9槽[60×8,24]；canonical引用508项检查、16份artifact抽样/小邮件哈希、8份intake副本哈希通过。两note分别独立文件，重复和legacy绑定0新增copy/排队，仅限verifier进程计数；后台模型用量未测，不能称零模型。
- 两小邮件intake51b6e6ea…、d1d131fb…均STORED/各4文件。前者run已完成21评分31排除；后者因同候选人后续资料变更SUPERSEDED、前五为空，正确保留旧任务而不冒充完整排名。
- 元数据、迁移、实际容量脚本及所有权实现已经本地commit，MAIL_FILE_FIELDS.md和MAIL_SOURCES.md已记录真实范围。

## 5. 浏览器恢复与后续权限

- 旧14消失后用户允许恢复，唯一新空间15，名称Twenty本地验收-20261101。根p1，audit_frontend仅p2。不能新space、claim他人空间、finish后继续操作或换CUA/Playwright绕过。
- 一次自动退出后根handOff请求本人登录，用户明确“你来登录吧”，根已takeOver同15，读取旧副本private/login.json内凭据只用于正常表单，p1/p2恢复登录；未打印密码、重置账号或弱化认证。退出原因尚未确证。
- Ego Skill /Users/jerry/.agents/skills/ego-browser/SKILL.md及ego-browser skill v2.2.0已完整读。snapshot subtree root只能用@ref；loc css的has-text必须terminal，角色可能快照重复名，实际aria-label可DOM只读核对。自动化选择器错误不算产品缺陷。
- 新SIWC连接仍0。当前真实材料、图片、object、原生Agent/tools使用只读Codex来源；不能把它当新本人授权成功。新SIWC本人Continue with ChatGPT、真实刷新/失效仍待验收；不要生成无法及时展示的授权URL。

## 6. 下一步

1. 核心UI已全链验收：p2新公司提交及两JD创建通过并精确关闭测试岗；p3资料保存/意向/确认分享/企业只读/撤回拒绝通过、无有效分享残留。根p1停在官方admin-panel#ai，尚未发OAuth。待交还给用户本人开始Continue with ChatGPT，不提前制造过期授权。
2. 最后回读新队列与旧同步/工作流/邮箱开关；本轮API38/两worker已重建并健康，无需重复。官方聊天单字段升级已dry-run/apply并验证原API读成功；不改guard或workspace版本，不将单项当整链升级完成。
3. 核心页面、Shadcn报告和数据链路HTML均已实际验收，不重复制造fixture；八个合成岗CLOSED，活跃集合46与manifest一致。55公司/174岗/928联系人/500候选人为最终含fixture数量，迁移原基线另记。三队列空闲、旧同步/工作流/收信开启0，私有delivery-health-final.json。
4. 个人飞书文档H0sld6jFuosjIMxd1TWc4PcanPb已personal/user精准更新至revision8，核心UI摘要已修正并回读检查通过，三大章保留；后续按新证据定向更新，不改对方原文、不发IM。
5. 新SIWC本人授权、自然新邮件到达观测、业务方质量核对仍是完整交付gate。自然收信若做，autoSubmit=false、仅新邮件、首封即关或15分钟截止、最后恢复原配置；不能把旧读取/空poll当自然到达。
6. 保存最终本地commits及运行版本证据，不推送。目标未全部满足不能mark complete；连续三goal轮同一阻塞且无可做工作时才按工具规则blocked，不把压缩次数当轮数。

## 7. 最后完成的独立工作

- 官方聊天缺mentionsResolvedAt已单workspace dry-run/apply并实测原API摘要成功，metadataVersion184、deferred0；未修改版本/状态/guard，未冒称完整升级链通过。
- 公司重复example.invalid触发原生唯一域名保护，改独立测试子域正常UI创建通过，未改源代码或权限；通用重复提示仍可后续改善，但不是创建链路失败。
- 最终仍需新SIWC本人授权、真实新邮件和业务质量确认。根接下来只处理本人就绪后的具体步骤，不重复空poll/重跑模型/伪造刷新，不以等待或预算标完成。
