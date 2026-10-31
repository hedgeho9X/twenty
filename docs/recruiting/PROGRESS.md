# 执行进度与证据

更新时间：2026-11-01，Asia/Shanghai。

## 当前状态

- 用户已明确授权开始自主执行全部本地外包工作。
- 权威目标：同目录 `DELIVERY_GOAL.md`；后续恢复必须先读取，不能只依赖对话摘要。
- 分支：`codex/fanhan-local-rebuild`，基于官方 `c0ad263b35a734dbd2528bf82c5dd38d3b18dc1b`。
- 尚未实现招聘业务或启动官方应用；独立数据库/缓存已经启动，旧本地 A 环境保留。

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

## 未完成的外部依赖

- ChatGPT 订阅仍需 Jerry 本人登录授权；不以旧 sidecar 启动代替验收。
- 旧临时火山 Key 在实验结束已删除。当前默认逐对 Jev 不依赖重新 embedding；后续若需要真实 Embedding 调用应使用明确授权的可用凭据。
- 不向远程 GitHub 或生产提交任何改动。
