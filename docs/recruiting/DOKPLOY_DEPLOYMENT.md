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

## Redis AOF 内存与恢复（2026-11-04）

本次生产证据已确认：Redis 在 256 MiB cgroup 内加载 AOF 后，自动 rewrite 的 fork/COW 导致 OOM 重启；API 鉴权读取缓存遇到 `LOADING Redis is loading the dataset in memory`，被现有 JwtAuthGuard 转为 403 `Forbidden resource`。这不是角色权限不足，不修改鉴权守卫。

生产 `deploy/compose.yaml` 的 redis 和本地 `compose.yaml` 的 cache 使用相同预算：容器 `mem_limit: 1536m`、Redis `--maxmemory 768mb`、`--auto-aof-rewrite-min-size 256mb`，保留 AOF 与 `noeviction`。2026-11-04 恢复后实测数据约 450 MB（used_memory），384mb 上限会让 noeviction 拒绝写入（实测约 1400 次 OOM 写拒绝），因此上调到 768mb；1536m 容器限制为 AOF rewrite fork 的写时复制、缓冲和分配器开销保留约 768 MiB 余量（实测 rewrite CoW 峰值仅约 5 MB）。256 MiB 最小 AOF 大小减少小文件 rewrite；自动 rewrite 百分比保留默认 100。请监控 used_memory，接近 768mb 前需排查数据增长或再扩容。

这不是 RSS 的硬保证：Redis maxmemory 不包含所有缓冲、碎片和 fork 内存。达到数据预算后 `noeviction` 会拒绝新增分配，而不是删除队列键；持续监测 used_memory、used_memory_rss、cgroup 峰值、持久化状态和主机可用内存。[Redis 7 配置](https://raw.githubusercontent.com/redis/redis/7.0/redis.conf)、[AOF rewrite/备份说明](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)、[BullMQ noeviction 要求](https://docs.bullmq.io/guide/going-to-production)。

以下由 Jerry 在生产执行，本次仓库修复不执行 Docker、Redis 或 Dokploy 操作：

1. 暂停自动发布，私下保存当前 Dokploy Compose/镜像版本。通过 Dokploy 停止 server、worker、migrate 及其他 Redis 写入方，再停止 redis；保持原 cache 卷。多段 AOF 必须整体备份，不能在 rewrite 中只复制某一个文件。
2. 在独立 Bash 会话中替换容器名，定位已停止容器的 `/data` 挂载并离线备份；不要导出容器环境变量：

```bash
set -eu
redis_container='REPLACE_WITH_DOKPLOY_REDIS_CONTAINER'
redis_data_dir="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$redis_container")"
test -n "$redis_data_dir"
test "$redis_data_dir" != /
test -d "$redis_data_dir"
test "$(docker inspect --format '{{.State.Running}}' "$redis_container")" = false
backup_dir="/var/backups/fanhan-redis-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 700 "$backup_dir"
sudo tar -C "$redis_data_dir" -cpf "$backup_dir/data.tar" .
sudo tar -tf "$backup_dir/data.tar" >/dev/null
```

3. 在 Dokploy 当前 Compose 中应用本次 redis 配置并 redeploy，复用同一 cache 卷和已批准的应用镜像；不要用仓库模板的 bootstrap 标签替换线上精确镜像。不要删卷、FLUSH、关闭 AOF 或手工删除 AOF 分段。部署后将 `redis_container` 更新为新容器名。
4. 核对实际限制/参数并至少观察 5 分钟（跨过多个原约 64 秒周期），在同一容器上重复 inspect；新容器的 RestartCount 从零重新计数，不能与旧 ID 直接比较：

```bash
docker inspect --format 'id={{.Id}} memory={{.HostConfig.Memory}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}' "$redis_container"
docker logs --since 10m "$redis_container"
docker exec "$redis_container" redis-cli PING
docker exec "$redis_container" redis-cli CONFIG GET maxmemory maxmemory-policy auto-aof-rewrite-min-size
docker exec "$redis_container" redis-cli INFO memory
docker exec "$redis_container" redis-cli INFO persistence
```

期望 memory=1073741824、maxmemory=402653184、noeviction、auto-aof-rewrite-min-size=268435456；日志出现 `Ready to accept connections`，PING=PONG，loading=0，RestartCount 不增长且 OOM=false。恢复 server/worker 后再次观察，并用同一正常会话验收两个手动匹配方向与结果轮询，确认 JwtAuthGuard 不再报 LOADING。

5. 仅在稳定、磁盘有足够新 base 文件空间、内存有余量，且 INFO persistence 的 aof_rewrite_in_progress=0、aof_rewrite_scheduled=0、rdb_bgsave_in_progress=0 时，考虑执行一次 `docker exec "$redis_container" redis-cli BGREWRITEAOF`；已经自动 rewrite 成功则无需重复。完成后检查 aof_last_bgrewrite_status=ok、aof_rewrite_in_progress=0 和稳定的 RestartCount。让 Redis 自行切换 manifest/清理旧段，不手工删这 171 个文件。

回滚应用时使用原精确镜像，但保留 1536m 的 Redis 限制（maxmemory 768mb）与 noeviction；不要把仍有同一数据集的 Redis 降回 256 MiB。需要恢复数据时，先停全部写入方和 redis，将完整离线备份恢复到新的独立卷，在 Dokploy 切换挂载后验证；保留故障卷供诊断，不覆盖运行中的数据。
