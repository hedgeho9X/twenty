# Twenty 进程内订阅 Provider

`authType: chatgpt` 使用官方 `@ai-sdk/openai` Responses 模型，fetch 适配层在当前服务进程转换上游协议。没有代理端口、Go 二进制或独立代理容器。

当前账号来源是本机已授权的 Codex ChatGPT 登录。读取固定的 `~/.codex/auth.json` 或服务端显式设置的 `RECRUITING_CODEX_AUTH_FILE`，要求当前进程拥有文件且权限不向其他用户开放。Provider 中的 subscriptionAccountId 绑定连接时的账号，账号切换后要求重新连接。

每次请求重新读取访问令牌，不复制或刷新原 Codex 登录，也不修改 Keychain。这个来源适用于当前本地环境；独立服务器的新 SIWC 授权、账号管理和刷新流程仍需继续实现，不能把本机来源称为已完成的新账号授权流程。

公共 SIWC Responses 与 Codex backend Responses 通过 protocol 分开。两个来源都强制 store=false 和 stream=true；AI SDK 非流式生成只有收到 response.completed 后才得到完整 JSON。中断、失败或 incomplete 不返回成功结果。图片和结构化输出继续通过官方 SDK 处理。

可选 `RECRUITING_MODEL_PROXY_URL` 使用已有 SOCKS5 连接，只影响该 Provider，不修改全局 fetch 或系统代理。订阅与 Jev/Embedding 的凭据、费用和额度分别管理。

本地已验证：账户模型目录、真实文本、AI SDK Output.object、图片结构化输出；适配器和私有账号读取的 12 项测试通过。当前 API 账号可用 gpt-5.6-sol，不根据全局示例或其他账号猜测模型 ID。

必要协议行为参考 CLIProxyAPI v8.0.48，来源和 MIT 许可见 `THIRD_PARTY_NOTICES.md`。
