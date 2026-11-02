# 恢复后的招聘元数据补齐

`ops/recruiting/bootstrap-target.mjs` 通过官方 `/metadata` GraphQL 与 `/rest/metadata/objects` 查询和修改，不连接数据库。默认只输出计划；只有 `--apply` 才执行。旧 `bootstrap-schema.mjs` 的本地行为不变。

远程调用必须同时传 `--target https://recruiting.math77.cn --workspace-id 4cb349cd-5765-4826-a2cb-73e5c5c2d564`，令牌由 `FANHAN_API_KEY` 或 `TWENTY_API_KEY` 注入，不接受命令行令牌。请求会先核验令牌实际对应的工作区 ID，禁止跳转与远程明文 HTTP。

计划覆盖原 bootstrap 的九类对象及字段，并补齐材料处理对象 `recruitingIntake`、原生 `FILES` 字段和邮件九槽布局。公司、联系人、岗位及原有跟进对象应由原生产恢复保留；缺少这些前置对象时明确失败，不凭空重建业务表。字段定义在 `backups/metadata-blueprint.mjs`，材料枚举定义在 `backups/intake-blueprint.json`。

字段类型不一致或已禁用会停止。新增枚举项保留旧值及 ID；FILES 容量只扩大、不缩小，保留其他 settings。新增字段和对象使用官方创建流程。只对明确未执行写入的 deferred migration guard 进行有界重试；网络中断或其他不确定写入失败不重试。

元数据计划与执行前快照默认保存在 `.local/recruiting/metadata-target-report.json`（0600），可用 `--report` 指定独立文件，生产计划和应用建议分别保存。执行完成会回读所有目标定义，计划为空才标记 verified。官方后台 schema deferred action 仍须由 workspace 队列运行，元数据回读不代替物理表/业务 API 验收。

本地只读验收：不传参数时核验本地工作区，当前计划为 0 项。安全与增量规则测试：`node --test ops/recruiting/backups/target-metadata.test.mjs`，7 项通过。尚未对新生产执行写入。

本切片不修改导航。旧 `configure-navigation.mjs` 依赖本地硬编码对象 ID，不应直接运行到生产；如需隐藏内部对象，应先从目标元数据按名称解析 ID，再单独审查导航计划。
