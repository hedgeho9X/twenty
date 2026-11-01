# Twenty 进程内 ChatGPT 订阅

账号在设置 → AI → 订阅与功能中连接。Twenty 自行创建 OAuth PKCE 事务、接收 localhost 回调、校验身份并加密保存令牌，不启动 CLI，不读取本机 Codex 凭据或模型缓存。

`subscriptionConnectionId` 绑定独立连接。每次模型请求重新从加密存储获取凭据；API 与 worker 通过原生 PostgreSQL 互斥串行刷新。过期、撤销或账号身份变化不会回退到其他账号。

Codex OAuth 与 SIWC 是两个独立协议。Codex 连接使用订阅 backend Responses；SIWC 使用公共 Responses。模型请求统一通过官方 AI SDK 和进程内 fetch 适配器，没有额外代理端口或容器。协议版本由适配器声明，不取自本机 CLI。

新连接启用前验证真实令牌刷新、模型目录及合成结构化输出，全部成功才切换提供方。额度和模型目录只返回必要字段，不向前端返回凭据。

连接文件由原生 SecretEncryptionService 加密，使用独立私有目录，权限 700/600。断开清除本地凭据，上游会话撤销结果单独报告。完整边界见 docs/recruiting/SUBSCRIPTIONS.md；协议来源与许可见 THIRD_PARTY_NOTICES.md。
