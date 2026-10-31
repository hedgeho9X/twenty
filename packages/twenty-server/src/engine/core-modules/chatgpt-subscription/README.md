# Twenty 进程内订阅 Provider

`authType: chatgpt` 使用官方 `@ai-sdk/openai` Responses 模型，fetch 适配层在当前服务进程转换上游协议。没有代理端口、Go 二进制或独立代理容器。

当前账号来源是本机已授权的 Codex ChatGPT 登录。读取固定的 `~/.codex/auth.json` 或服务端显式设置的 `RECRUITING_CODEX_AUTH_FILE`，要求当前进程拥有文件且权限不向其他用户开放。Provider 中的 subscriptionAccountId 绑定连接时的账号，账号切换后要求重新连接。

每次请求重新读取访问令牌，不复制或刷新原 Codex 登录，也不修改 Keychain。这个来源适用于当前本地环境；新增SIWC账号由独立加密连接模块管理；本人新授权及远程服务器流程尚未真实验收，不能把本机来源称为已完成的新账号授权。

公共 SIWC Responses 与 Codex backend Responses 通过 protocol 分开。两个来源都强制 store=false 和 stream=true；AI SDK 非流式生成只有收到 response.completed 后才得到完整 JSON。中断、失败或 incomplete 不返回成功结果。图片和结构化输出继续通过官方 SDK 处理。

可选 `RECRUITING_MODEL_PROXY_URL` 使用已有 SOCKS5 连接，只影响该 Provider，不修改全局 fetch 或系统代理。订阅与 Jev/Embedding 的凭据、费用和额度分别管理。

本地已验证：账户模型目录、真实文本、AI SDK Output.object、图片结构化输出；适配器和私有账号读取的 12 项测试通过。当前 API 账号可用 gpt-5.6-sol，不根据全局示例或其他账号猜测模型 ID。

必要协议行为参考 CLIProxyAPI v8.0.48，来源和 MIT 许可见 `THIRD_PARTY_NOTICES.md`。

新增siwc-protocol实现官方开源公共客户端协议：动态注册、PKCE、签名ID token的issuer/audience/nonce/到期校验、账号模型目录、刷新和会话撤销。纯协议9项、协议/加密存储/刷新/loopback组合共19项合成测试通过，已接管理员账号存储及官方AI设置页。本人新授权、真实刷新与页面验收仍未完成，不能标为SIWC真实验收。原机Codex来源保持只读，完整边界见docs/recruiting/SUBSCRIPTIONS.md。

协议依据：[注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[账号与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[实时OIDC发现](https://auth.openai.com/.well-known/openid-configuration)。本轮已核对官方RS256、公有端点和无客户端密钥的动态注册流程；不是把旧Codex Token混用到公共SIWC API。
