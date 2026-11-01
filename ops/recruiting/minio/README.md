# 本地 MinIO

通过 Twenty 官方 S3 文件存储驱动接入，桶名为 `twenty-local`，服务只监听本机：API `127.0.0.1:23004`，控制台 `localhost:23005`。账号密钥只放 `.local/recruiting/minio.json` 与 `minio.env`，不提交到仓库。没有连接线上桶。

MinIO 社区版已改为源码分发，此处从官方 `github.com/minio/minio` 的 `v0.0.0-20260212201848-7aac2a2c5b7c` 构建 Linux ARM64 二进制，适用于当前 Apple Silicon / OrbStack 环境。镜像内附 AGPL-3.0 许可证，官方源码缓存保留在私有构建目录。

## 初次配置

1. 使用 Node 26 运行 `ops/recruiting/minio/build.mjs` 构建本地镜像。
2. 运行 `ops/recruiting/minio/migrate.mjs` 创建私有配置与桶，复制原文件并按 SHA-256 回读验证。
3. 暂停 API 和 worker，再运行该迁移命令的 `--activate` 模式；它再次核验文件，备份原环境配置后切换 S3。
4. 恢复 API 和 worker。后续 `ops/recruiting/local.mjs up` 会在 S3 模式下连同 MinIO 启动。

原生文件 ID、对象权限和上传完成校验不变；S3 键保留原工作区/应用 universalIdentifier/相对路径，MIME 来自原生文件元数据。浏览器通过原生鉴权接口访问文件，未开启匿名桶权限或直接跨域上传。

## 数据与回退

数据在 `object-storage` 卷中；原本地文件不会删除。配置和迁移清单位于 `.local/recruiting/backups/before-minio-*`，近期校验记录为 `minio-migration.json`、`native-s3-verification.json`。清理业务前应备份桶；原仅针对本地磁盘的清理脚本在 S3 模式会拒绝执行。

如需回退，先暂停写入，保存切换后新上传的对象，再恢复原存储配置。不能只切回磁盘而遗漏新对象。解析过程中的临时输入和页图继续保留在本地解析目录，它们与归档原件的 S3 存储分工独立。
