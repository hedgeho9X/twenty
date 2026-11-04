# 招聘系统部署

## 目标

在腾讯云 43.136.55.30 的 Dokploy 部署 Twenty 前后端、Worker、PostgreSQL 和 Redis，生产入口为 https://43.136.55.30，由 Compose 的 FANHAN_PUBLIC_URL 注入 SERVER_URL/FRONTEND_URL。文件解析计算不部署在这台服务器。早期目标 150.158.164.85 / recruiting.math77.cn 仅作历史记录，下文 2026-11-03 记录发生在该主机。发布分支为 hedgeho9X/twenty 的 deploy/fanhan；保留旧环境及其数据。

## 发布链路

1. 专属分支提交触发 Fanhan production。
2. 招聘、订阅和前端回归，以及两端类型检查通过。
3. CI 构建完整 Twenty 镜像，写入 commit 标签，经专用 SSH 导入账号传到服务器。
4. CI 更新 Dokploy Compose 的精确镜像版本，再调用部署接口。
5. 检查部署记录、容器健康、HTTPS、登录、鉴权接口和 Worker。

CI 不在应用启动时导入或覆盖数据库。Compose 默认禁用启动迁移；首次恢复和后续 schema 升级必须先备份，再显式运行并验证。失败的迁移不能通过应用健康检查代替验收。

## 持久数据

- database：PostgreSQL；仅内部网络可访问。
- cache：Redis AOF，保存队列和短链接。
- files：原始简历、邮件附件等，共享给 API 和 Worker。
- 密钥仅保存在 Dokploy 环境和 GitHub Actions Secrets，不写入仓库。

服务器不依赖 GHCR；镜像只允许通过受限 SSH 导入账号导入。GitHub 环境 fanhan-production 需要 FANHAN_DOKPLOY_URL、FANHAN_DOKPLOY_API_KEY、FANHAN_DOKPLOY_COMPOSE_ID，以及 FANHAN_DEPLOY_KEY、FANHAN_KNOWN_HOSTS。模板不包含解析容器；启用解析前配置可用的外部解析接口。

## 完成条件

- [ ] Dokploy 管理员初始化、镜像拉取及代理正常。
- [ ] 专属分支已推送，CI 检查及镜像构建真实通过。
- [ ] 旧生产数据库和文件备份已验证，恢复到新环境并核对数量。
- [ ] 应用和 Worker 健康，数据库与缓存无公网端口。
- [ ] https://43.136.55.30 的 HTTPS、登录及 API 验证通过。
- [ ] 实际提交能自动更新到对应 commit，失败时不发布。
- [ ] 外部解析尚未接入时明确显示不可用，不伪报成功。

## 当前检查证据

2026-11-02：后端 1844 个测试套件通过，13136 项通过、44 项跳过；前端招聘相关 19 个套件、149 项通过。前后端类型检查通过。完整生产部署尚未验收。

## 启动前恢复检查（2026-11-03）

原生产已恢复到新目标，53/166/928的未删除公司、岗位、联系人数量一致；1211个附件共1875233405字节，目标逐项SHA256核验0失败。新目标工作流及收信关闭。旧生产未修改。

预检使用已通过CI检查的577b830镜像执行备份和官方upgrade（未部署为最终应用）。发现APP_VERSION不能直接填SHA，已将CI改为原生版本号加提交build metadata。目标备份成功。

首次upgrade在2.51 AddContentSha256ToFile触发默认10秒query timeout，保存了失败cursor；提高超时后的重试被官方升级顺序保护阻止。不要直接改游标或强制跳过依赖步骤。下一步先核对新目标无业务写入/应用未启动，从保留的原始恢复流重新恢复这个新目标库、再次停用复制的自动化，并在首次升级时使用120秒迁移超时。原始dump、附件及新目标备份均保留。若再次超时，必须查具体锁/查询原因，不能无限重试。

后续：干净恢复并使用120秒超时后官方upgrade已成功（exit0）；53公司/166岗位/928联系人数量仍一致。通过现有用户正常认证，并经官方API创建2天短期验收Key，未绕过生产模式CLI生成Key限制。临时验收API与Worker已启动，IP健康曾返回200；该版本为577b830且仅作迁移验收，不是最终发布。

元数据计划63项，应用期间遇到原生延迟DDL保护；Worker启动后相关队列已处理，再次按新计划增量应用时出现HTTP超时，执行结果需恢复后重新读取，不能盲目重放写入。随后IP健康和SSH均超时（SSH banner exchange），ping仍正常。尚不能断言是内存或其他主机问题；已准备API/Worker/PG/Redis内存上限但未应用到服务器。用户已被请求查看腾讯云VNC/监控。停止旧版自动发布以免恢复时抢先覆盖配置。原生产和所有备份保留，未做重装/磁盘重置。

公开工具交付：fanhan-cli-v0.3.0 已发布为 GitHub Pre-release，包含 fanhan-cli.tgz、fanhan-recruiting-skill.zip、SHA256SUMS；下载URL与API Key页面提示词一致。预发布说明明确尚未完成腾讯云生产端到端验收，不将工具包可下载等同服务上线。

主机复核：直连及另一条代理网络的SSH均停在banner exchange超时，HTTP健康超时，ICMP仍有回复；没有足够证据认定具体原因。当前需通过腾讯云VNC/监控确认主机状态后恢复SSH。恢复后先停验收API/Worker做资源诊断，保留PG/Redis与卷；核对OOM、磁盘及数据库活动，再应用已准备的资源上限，读取元数据最新状态后继续增量操作。
