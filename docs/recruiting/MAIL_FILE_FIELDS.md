# 邮件归档原生文件字段准备

`ops/recruiting/ensure-mail-file-fields.mjs` 是独立于整库 bootstrap 的幂等准备步骤。只调用固定本地实例的原生元数据 API，不使用 SQL 修改元数据，不修改业务记录、文件所属分区、临时状态或上传凭据。默认只读计划，只有 `--apply` 才执行变更。

## 容量与布局依据

- `domain/mail-file-layout.ts` 导出附件上限 500、总资源上限 504，`mail-material.ts` 直接使用该附件常量。总资源包括 raw EML、metadata，以及最多两份 text/HTML 正文。
- 原生 FILES 每字段最大 60，保持该全局上限。`RECRUITING_MAIL_FILE_LAYOUT` v1 固定每槽 60、九个字段：`sourceFiles`、`sourceFiles2` 至 `sourceFiles9`，总容量 540，覆盖 504 项而不截断。九槽均绑定同一 recruitingMailArchive，沿用同一父记录的权限边界，不增加资源对象。
- 统一接收 schema 的 files 上限是 30，故 `recruitingIntake.files` 和 `person.candidateResumes` 的 `settings.maxNumberOfValues` 至少为 30。
- 脚本 require 编译后的领域布局与 twenty-shared 原生上限，不复制一套资源数量推断。运行前必须先构建最新共享包及 server，且 API 应已运行同一版本。
- 邮件槽的 metadata 容量必须为 60；其他 settings 原样保留。两个接收/候选人字段保留更高的既有容量。超出原生上限、字段类型冲突、待更新字段归属其他应用或归档槽布局冲突时，均在任何 mutation 前拒绝，不缩小既有设置或改写 owner。

## 执行步骤

1. 核对当前运行实例来自本仓库，私有 environment 指向 `127.0.0.1:25432/recruiting`。使用 [RUNBOOK.md](./RUNBOOK.md) 的固定 Node 版本。脚本使用现有个人会话，不生成或打印凭据。
2. 先运行 `node ops/recruiting/ensure-mail-file-fields.mjs` 查看十一项目标的计划。可选 `--intake-only` 只核对两个 30 项字段，不表示九槽已经完成。缺少编译后的领域常量时脚本直接退出，不改用猜测的槽位或容量。
3. 计划正确后，使用相同参数加 `--apply`。脚本在首次写入前将全部目标字段的原始完整元数据（包括 settings、applicationId，缺失字段记录为 null）保存到私有 `.local/recruiting/mail-file-fields-all-backup-v1.json`；intake-only 使用单独的 `mail-file-fields-intake-backup-v1.json`。既有备份不覆盖。操作结果私存为同前缀 report，终端只输出字段名、容量和检查状态。
4. 创建使用 `CreateOneFieldMetadataInput.field`，原生服务自动归属工作区自定义应用；更新使用 `UpdateOneFieldMetadataInput` 的 `id` 与 `update.settings`。这两个输入不能用于重写 applicationId。无需修改的现有字段保持其 owner；需要扩容但 owner 不属于当前自定义应用时，脚本会预检拒绝并保留原状。更新时将原 settings 整体带回，只提高 maxNumberOfValues。
5. 如遇原生 `DEFERRED_WORKSPACE_MIGRATION_ACTIONS_IN_PROGRESS`，脚本仅对此明确发生在 mutation 之前的 guard 最多等待重试 20 次。其他错误或网络结果不确定时立即停止；重新运行会先回读字段再决定是否需要继续，不盲重放创建。
6. 若 deferred guard 持续阻塞，先按原生 deferred action/队列状态核对本地工作区待办。仅在确认待办归属后临时启用专用 `workspace-queue` worker 完成迁移，再停止该临时 worker并重新运行计划。不要启动旧邮件、发送、日历、工作流队列或 cron。脚本本身不会启用任何 worker。
7. metadata 回读通过只证明字段配置已写入；准备脚本 report 的 `deferredActionsVerified` 固定为 false，必须另外核对原生 deferred action。当前这轮已独立核实该工作区 deferred action 为 0 行，并完成下述原生绑定与容量验证，不能仅依据 metadata report 判定生命周期完成。

## 已完成的本地验证（2026-11-01）

- 九个归档槽已通过原生元数据 API 创建并回读，每槽 60，总容量 540；九个物理列存在，该工作区 deferred action 为 0 行。`recruitingIntake.files` 原有容量 60 保留，`person.candidateResumes` 从 8 调为 30，其他 settings 与原字段 owner 保留。私有原配置备份及回读报告分别为 `mail-file-fields-all-backup-v1.json`、`mail-file-fields-all-report.json`。
- `migrate-mail-file-ownership.mjs --apply` 完成当前本人可见、签名有效的 3 份旧归档和 18 份资源迁移，原件与 artifacts 前后共 42 次 SHA256 对比全部一致；0 缺原文、0 签名过滤、0 错误。归档 ID、来源摘要、来源事件及已接受 intake 关联保持，旧文件不删除，也不重新解析或排队。证据 `mail-file-ownership-evidence-v1.json` 明确限定当前权限范围，不声称证明整个工作区的不可见记录。
- `smoke-mail-file-ownership.mjs --worker-mode` 经真实 worker 展开固定 text、HTML 与 500 个极小 TXT 附件，得到 504 份 artifacts；槽位实际分布为 `[60,60,60,60,60,60,60,60,24]`。504 个 canonical 引用均核对原生字段分区、owner 与永久/未删除标志，原件 SHA 正确；容量邮件进行了 12 份首尾及槽边界 SHA 抽样，没有把该抽样称为 504 份全量哈希验证。
- 另一封小合成邮件的 4 份 canonical 资源全部哈希通过；相同简历的两种 note 各自形成 4 份 intake 文件，与 canonical 及另一份 intake 完全不交叉，8 份副本 SHA 全部通过。重复请求 ID 与父归档的 key/fileId 绑定保持，verifier 进程未新增 copy 或排队；旧合成归档仍复用原 `ead17ffe-3cf0-572f-b4d3-56995621ee0e`，未分配新副本或重新排队。证据 `mail-file-ownership-smoke-v1.json`。
- 两份新邮件 intake 已独立经 GET 回读为 `COMPLETED / STORED`，各保留 4 份文件；后台模型用量未在该 smoke 中测量。脚本的 `parsingAcceptedOnly=true` 表示 verifier 本身只验收受理与归属，不能解读成后台没有解析、匹配或模型消耗。

## 回退边界

原始设置可从私有备份核对。回退仍走原生 updateOneField，只恢复经过人工确认的 settings，不改字段归属、不删除已有附件或新字段。降低容量前须先核实既有记录的文件数量，不能自动将已绑定超过旧容量的字段调回较小数值。该脚本未提供自动删除字段或数据库回退。

上述证据覆盖元数据、旧归档迁移、合成容量和文件生命周期，不等于已观察到自然新邮件投递；自然新邮件尚未观察到。
