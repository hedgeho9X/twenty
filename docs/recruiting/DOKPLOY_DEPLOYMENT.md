# 招聘系统部署

## 目标

在 150.158.164.85 的 Dokploy 部署 Twenty 前后端、Worker、PostgreSQL 和 Redis，访问域名为 recruiting.math77.cn。文件解析计算不部署在这台服务器。发布分支为 Zkkk-web/twenty 的 deploy/fanhan；保留旧环境及其数据。

## 发布链路

1. 专属分支提交触发 Fanhan production。
2. 招聘、订阅和前端回归，以及两端类型检查通过。
3. CI 构建完整 Twenty 镜像，写入 commit 标签并推送 GHCR。
4. CI 更新 Dokploy Compose 的精确镜像版本，再调用部署接口。
5. 检查部署记录、容器健康、HTTPS、登录、鉴权接口和 Worker。

CI 不在应用启动时导入或覆盖数据库。Compose 默认禁用启动迁移；首次恢复和后续 schema 升级必须先备份，再显式运行并验证。失败的迁移不能通过应用健康检查代替验收。

## 持久数据

- database：PostgreSQL；仅内部网络可访问。
- cache：Redis AOF，保存队列和短链接。
- files：原始简历、邮件附件等，共享给 API 和 Worker。
- 密钥仅保存在 Dokploy 环境和 GitHub Actions Secrets，不写入仓库。

新服务器必须配置 GHCR 只读拉取凭据。GitHub 环境 fanhan-production 需要 DOKPLOY_URL、DOKPLOY_API_KEY、DOKPLOY_COMPOSE_ID。模板不包含解析容器；启用解析前配置可用的外部解析接口。

## 完成条件

- [ ] Dokploy 管理员初始化、镜像拉取及代理正常。
- [ ] 专属分支已推送，CI 检查及镜像构建真实通过。
- [ ] 旧生产数据库和文件备份已验证，恢复到新环境并核对数量。
- [ ] 应用和 Worker 健康，数据库与缓存无公网端口。
- [ ] recruiting.math77.cn 的 HTTPS、登录及 API 验证通过。
- [ ] 实际提交能自动更新到对应 commit，失败时不发布。
- [ ] 外部解析尚未接入时明确显示不可用，不伪报成功。

## 当前检查证据

2026-11-02：后端 1844 个测试套件通过，13136 项通过、44 项跳过；前端招聘相关 19 个套件、149 项通过。前后端类型检查通过。完整生产部署尚未验收。
