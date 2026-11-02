# 原生产备份证据

2026-11-03，通过 InstaCloud 项目 `773014cc-263e-4060-8318-b049e86c809d` 的 main/server 私网读取原生产数据库，没有开启数据库公网访问，没有重启或改写原业务记录。

## 本地备份

位置：仓库私有目录 `.local/recruiting/backups/original-production/`，不提交数据或凭据。

- `original.sql.gz`：原始 SQL gzip，155,707,813 bytes；SHA256 `2e9a06d112941d623d5c78814d41dc041690fc2ea233fc959ebd80b3c5a5b508`，与源端逐字节一致。
- `files/`：1211 个 S3 原始对象，共 1,875,233,405 bytes。
- `objects-manifest.json`：每个对象的原 key、长度、Content-Type、ETag、SHA256。
- `database-table-counts.json`：SQL dump 中 125 个 COPY 表的逐表行数，用于恢复后核对。
- `backup-summary.json`：源版本、源项目、数据库摘要及对象总量。

全部对象已再次读取并核验 SHA256 与长度。数据库导出在一致性快照中完成，文件遍历是另一次读取，二者并非跨系统原子快照；正式切换前应核对旧环境后续新增数据。

## 数据规模

源数据库 PostgreSQL 16.15，总大小 529,431,575 bytes。联系人包括候选人与其他角色，不能把全部联系人数量当候选人数。

| 业务表 | 总记录 | 未删除 |
| --- | ---: | ---: |
| 公司 | 75 | 53 |
| 岗位 | 182 | 166 |
| 联系人 | 972 | 928 |

未删除联系人中，带 CANDIDATE 角色的有 500 位。未删除岗位状态为：在招 46、停招 101、待补资料 19。

## 恢复兼容性

源服务自带 pg_dump 18.6，因此原件包含 PG18 的 `SET transaction_timeout = 0`。源扩展为 citext、pg_stat_monitor、pg_stat_statements、pgaudit、unaccent、uuid-ossp、vector。

`node ops/recruiting/backups/prepare-pg16.mjs` 从原件生成独立 `restore-pg16.sql.gz`：仅过滤一行 PG18 transaction_timeout，以及 pg_stat_monitor/pgaudit 的四行 CREATE/COMMENT。这两个扩展属于源平台监控组件；业务 COPY 数据不做更改。其余扩展仍要求新目标具备。脚本只生成恢复输入，不连接或写入目标数据库。

`node ops/recruiting/backups/verify-original.mjs` 可重新校验本地所有备份字节。两个命令可传入自定义备份目录或源/目标路径，且恢复准备拒绝覆盖原始输入及已有输出。

## 传输与边界

原数据库关闭公网访问。导出在原 server 的私网内执行并直接 gzip，没有保留巨大的明文临时文件。传输时使用 AES-256-GCM 加密，仅在原私有桶的独立 `_migration_backup/` 前缀创建一个临时对象；下载、解密、SHA256 校验后已删除该对象。原 S3 对象均只读，没有修改。

本文件证明备份完成，不代表新环境恢复、数据模型升级、附件链接或生产切换已经验收。恢复操作由部署流程单独执行。
