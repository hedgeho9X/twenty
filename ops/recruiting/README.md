# fanhan 招聘 CLI

面向招聘 Agent 的入口是 `fanhan`：使用 Node.js 22+，通过 `FANHAN_BASE_URL` 与 `FANHAN_API_KEY` 连接实例。`fanhan --help` 列出七组业务动作；`fanhan candidates --help --json` 只列出候选人相关命令。无需加载 Twenty 的 MCP 工具目录。

`fanhan candidates upload --file 简历.txt --key 本次提交标识 --wait` 会等待入库及关联匹配；`fanhan draft generate --match-run-id ID --top 5 --key 文案标识 --wait` 返回文案和分享链接。完整 Agent 工作说明在 `.agents/skills/fanhan-recruiting/SKILL.md`（仓库根目录）。

命令行仅依赖 Node 内置模块。npm 包入口为 `fanhan.mjs`；`schema --json` 与分组帮助不要求凭据。对远程实例要求 HTTPS，凭据仅通过环境变量传入。

以下是本仓库开发与部署说明，普通 CLI 使用者无需执行。

# 本地官方源码环境

本目录只管理 `twenty-recruiting` OrbStack 项目，保留 `fanhan-local` 对照项目。源码来自当前 fork，不使用旧泛函服务器镜像。

使用仓库要求的 Node 26。依赖安装使用仓库内固定的 `.yarn/releases/yarn-4.18.1.cjs`；CLI workspace 的 package name 是 `twenty`。

以 `.nvmrc` 的 Node 26.12.1 为准。本地运行器会把 `ops/recruiting/bin/yarn` 加到子进程 PATH，使 Nx 使用仓库固定的 Yarn，而不要求修改系统全局安装。

运行 `node ops/recruiting/local.mjs init` 创建私有配置，再运行 `node ops/recruiting/local.mjs up` 启动独立 PostgreSQL 和 Valkey。

数据连接限定 `127.0.0.1:25432/recruiting`，缓存使用 `26379`；UI 预留 `http://localhost:23000`，源码 API 监听 `23001`。配置和文件放在 Git 忽略的 `.local/recruiting/`，不得提交。

安装依赖后执行 `node ops/recruiting/local.mjs build`。空数据库使用 `database-init` 初始化官方 schema；恢复历史数据库后应运行官方升级命令，不执行重置。`api`、`front`、`worker` 分别在独立终端运行。

初始配置关闭邮箱同步和 cron 注册，邮件使用日志驱动，防止恢复历史数据后触发真实外部动作。受控邮件接入需要在业务适配和去重通过验证后启用。

`down` 保留数据库和缓存卷。脚本没有删除卷、全局停止 Docker、数据库重置等命令。

## 导入既有本地副本

`node ops/recruiting/import-snapshot.mjs <旧环境的private目录>` 只读 `fanhan-local-db-1`，将新 dump 单事务恢复到 `twenty-recruiting-db-1` 的空 `recruiting` 库。脚本固定目标并验证 OrbStack、Compose 项目和空库，已有数据时拒绝执行，不含强制覆盖选项。

恢复后停用旧工作流、邮箱/日历同步、逻辑函数触发器和 Webhook；只复制认证加密所需的服务器密钥到私有配置，不启用旧部署连接。原始自动化定义仍保存在只读 dump 和未改动的 A 环境中。

附件复制到独立本地存储，业务数量及隔离状态写入私有 `import-report.json`。旧记录内容和新版 schema 的兼容性、文件可下载性还需后续验证，不能仅凭导入退出码判断。

以上是运行方式；真实启动、数据迁移与页面验收状态以 `docs/recruiting/PROGRESS.md` 为准。

## 离线匹配评测

`node ops/recruiting/evaluate-cache.mjs --source <实验work目录>` 校验完整输入哈希、模型缓存和覆盖率，输出到私有 `.local/recruiting/evaluations/cache-baseline/`。缺失、陈旧或重复评分不能冒充完整结果。

可传 `--constraints <JSON>` 和 `--labels <JSON>`。条件格式为 `{candidates:{id:{employmentTypes:{values:["full_time"],certainty:"confirmed"}}},jobs:{id:{employmentTypes:["internship"]}}}`；只能输入从原话/人工确认核实的条件，未知不能猜成 confirmed。标签数组每项包含 candidateId、jobId、label、reviewerType、依据；未标注不是负样本。

这只是缓存回放与规则验证，不发模型请求。历史 30 人的分组不是未见测试集，也不能把原有 Agent 审阅当用户确认的标准答案。新增协议需要独立材料复核和未见样本验证。

回归命令：`node --test ops/recruiting/evaluate-cache.test.mjs`；领域规则使用仓库 twenty-server 的 Jest 配置执行 `match-policy.spec.ts`。
