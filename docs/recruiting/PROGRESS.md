# 执行进度与证据

更新时间：2026-11-01，Asia/Shanghai。

## 当前状态

- 用户已明确授权开始自主执行全部本地外包工作。
- 权威目标：同目录 `DELIVERY_GOAL.md`；后续恢复必须先读取，不能只依赖对话摘要。
- 分支：`codex/fanhan-local-rebuild`，基于官方 `c0ad263b35a734dbd2528bf82c5dd38d3b18dc1b`。
- 官方应用尚未启动；独立数据库/缓存已启动并迁入完整本地副本，旧 A 环境保留。

## 已核实

- 当前官方源码版本 2.55.0，已有 REST、GraphQL、原生 `/mcp`、角色鉴权和新的 CLI。
- MCP 通过 `ToolRegistryService` 暴露原生及应用逻辑函数工具；需要进一步核对业务工具注册和文件传输边界。
- CLI 有 `data list/get`、`api rest/graphql`；当前 REST 请求只支持 JSON body，文件上传尚需薄封装。
- 当前 `twenty-ui` 有公开组件/主题文档，应以当前源码导出为准，不照搬旧组件路径。
- 旧本地库只读盘点：53 公司、166 岗位、163 公司关联、163 JD 正文、139 岗位偏好、100 公司偏好快照；25 公司有招聘偏好。
- 旧 intake：3 CANDIDATE、1 JOB；原始材料不能由派生 JSON 无损重建。
- 实验：30 人 × 46 岗真实 Jev 全量评分已完成；当前选择逐对评分，明确约束先由程序处理。旧向量召回不是当前默认 Pipeline。
- OpenAI 官方 SIWC 文档明确公共 Responses 路径和账户模型目录；CLIProxyAPI 的 Go SDK/协议实现仍在核对。无新本人授权，未发真实订阅推理。

## 下一步

1. 完成 API/SDK/UI/订阅代码调查及技术决策记录。
2. 安装本地开发依赖，建立独立 OrbStack 数据库/缓存与源码运行环境。
3. 按 DELIVERY_GOAL.md 逐项实施并追加真实验证证据。

## 本地基础设施验证

- `ops/recruiting/local.mjs up` 成功，`twenty-recruiting-db-1` 与 `twenty-recruiting-cache-1` 均 Healthy。
- 数据库实查：`recruiting|twenty|0`，为独立空库，不是旧泛函或 AirJelly 数据库。
- 配置重复 init 内容不变，配置权限 0600，`.local/recruiting/environment.json` 已确认被 Git 忽略。
- UI 预留 23000、源码 API 23001、PG 25432、Valkey 26379；仅 DB/缓存已运行，不能据此报告应用可用。
- Node 26.7.0 满足 package engine；仓库 `.nvmrc` 固定 26.12.1，需留意真实构建差异。依赖安装进行中。

## 数据副本导入验证

- `ops/recruiting/import-snapshot.mjs` 从 A 的只读 pg_dump 复制到独立空库 B，恢复使用单事务，拒绝覆盖已有库。
- 源/目标均为：53 公司、166 岗位、925 联系人、497 候选人。
- 对 50 张业务表按所有行计算摘要，源/目标全部一致；仅工作流相关表按隔离要求停用。
- 1206 个文件共 1,870,957,537 bytes 已复制；所有文件大小一致，确定性抽样 10 个 SHA-256 一致。
- A 保留 18 个 ACTIVE 工作流版本，B 为 0；B 的邮件、日历同步均为 0。旧逻辑函数触发器、Webhook 与生产域名在 B 清除。
- 原始只读 dump、全表摘要及文件检查保存在 `.local/recruiting/`，未提交个人资料或凭据。
- 导入不等于已与新版代码兼容：下一步运行官方升级并回读验证，修复兼容问题后再启动 worker。

## 未完成的外部依赖

- ChatGPT 订阅仍需 Jerry 本人登录授权；不以旧 sidecar 启动代替验收。
- 旧临时火山 Key 在实验结束已删除。当前默认逐对 Jev 不依赖重新 embedding；后续若需要真实 Embedding 调用应使用明确授权的可用凭据。
- 不向远程 GitHub 或生产提交任何改动。

## 匹配领域与评测基线

- 新增 `src/modules/recruiting/domain/match-policy.ts`：只过滤明确冲突，保留未知；支持岗位同时接受多种雇佣/办公方式，远程与城市条件分别处理。
- 双向共享缓存键覆盖工作区、人/岗/公司版本、协议和模型。Jest 22 项通过，独立 TypeScript 检查通过。
- 离线评测 CLI 已复用全部 1380 对缓存，输入哈希与覆盖验证通过；4 项 CLI 行为测试通过，无新增模型调用。
- 历史 30 人均已被审阅，22/8 分组只作回顾性调优/验证，不能称未见测试集；尚未装入独立标签或已确认条件，不能报告招聘准确率或硬条件合规率。

## 解析实现进展

- 原生 Python 3.12 私有环境已安装 Docling 2.145.0、RapidOCR、Playwright；下载约 730MB 固定模型与私有 Chromium。
- parser 服务和文件边界已实现初稿。6 项测试通过：鉴权、路径隔离、哈希变更、中文职业正文保留、HTML 主动内容清理、真实长 Markdown 分页预览。
- 真实合成 PDF 和 PNG 均经 CPU Docling 处理，状态 complete、各 1 页，均提取到 TypeScript 与 Backend；原始报告在 `.local/recruiting/parser-smoke/report.json`。
- 发现并修复禁脚本浏览器中 add_style_tag 卡住问题，改为在固定 HTML 内容中注入样式，保持上传脚本禁用。
- Word/旧 DOC、中文扫描质量、服务容器及 Node 业务接入仍未验收。

## 当前构建状态

- Yarn focus 依赖安装已成功。直接连接停传后，使用仅供安装的本机 HTTP CONNECT→既有 SOCKS 桥接恢复，未修改全局网络配置。
- 固定 Node 26.12.1 已从官方归档下载并校验 SHA-256，位于 `.local/recruiting/runtime/`；后续构建优先使用该版本。
- 新 Nx 的 binary 路径为 `dist/bin/nx.js`；本地运行器已改为调用 `.bin/nx`，避免硬编码旧路径。
- `server-build.log` 记录官方源码构建，`parser-build.log` 记录解析镜像构建。CPU torch 2.15.0、CPU torchvision 0.29.1 已选定，避免引入无用 CUDA 依赖。
- Docker Hub DNS 超时通过宿主机代理下载官方镜像再 docker load 处理；Python 基础镜像平台 digest 为 `sha256:e0b3f8d16a5ccfbe602d5c94297e5dbcda2ec256edca2b80fcd44e39e1ff6feb`。
- 不把基础设施、解析单测或静态构建当应用验收；新 UI/API、升级、上传与 Agent 流程尚未打通。
