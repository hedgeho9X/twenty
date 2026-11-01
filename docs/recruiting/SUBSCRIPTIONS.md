# Twenty进程内ChatGPT订阅

## 1. 两种独立账号来源

本机Codex登录继续只读原auth.json，由原应用维护，Twenty不复制或刷新该文件。新SIWC连接独立保存，经官方开源公共客户端流程完成本人授权后，使用公共Responses及账号模型目录。两个协议、令牌、账号和模型目录不混用，不新增代理进程或容器。

设置入口位于官方管理面板AI页的ChatGPT订阅区域。普通运营、API Key、应用和Agent不能管理实例订阅；只有直接本人管理员会话可操作。新增账号不会自动改变现有默认模型。

## 2. 新授权与账号配置

1. 点击Continue with ChatGPT，使用当前进程创建的127.0.0.1临时回调进入本人授权。页面显示10分钟有效期；刷新设置可恢复同一人的未完成尝试。没有打开授权页面时可取消；回调已被消费后等待校验结果。
2. 校验state、PKCE及签名身份的issuer、audience、nonce、有效期和账号一致性，再保存连接。只有身份授权而没有订阅使用权限时，显示缺少权限，不允许推理。
3. 选择已授权账号，加载其实际可用模型，添加到原生Provider。图片能力须按模型确认后启用。添加不覆盖同提供方其他模型，也不自动切换默认档位；在下方官方默认模型或Agent设置中选择即可。
4. 重新授权保留同client/account映射。断开先尝试撤销上游可续期会话，再清除本地令牌；未确认远程撤销时明确提示，可在ChatGPT设置中处理。

回调为本机loopback流程；本轮仅验证本地环境，未验收远程服务器端口转发及本人新授权。后台账号来源的“已授权”状态不是每次模型推理成功的证明。

## 3. 存储和刷新

连接放在原生存储目录之外的chatgpt-subscriptions私有兄弟目录，也可由服务端RECRUITING_CHATGPT_CONNECTIONS_PATH指定。目录700、文件600，拒绝符号链接和错误所有者。使用官方SecretEncryptionService的AES-GCM版本化信封，全部令牌一起加密并通过临时文件原子替换，凭据不进入前端、模型配置JSON或日志。

API与worker使用同目录/同原生加密密钥。每个连接复用官方PostgreSQL advisory lock跨进程串行刷新，进入锁后重新读取，防止旋转令牌竞争。刷新失败不换用其他账号；invalid_grant或已返回替换令牌却无法验证时清除可用凭据并要求重连。SDK实例可缓存，凭据每次请求重新加载。

## 4. 已验证与未验证

- 原本机来源真实通过文本、复杂候选人object、图像object；官方runAgent通过文本、平面object、学习/执行招聘工具和图片。图片原生附件改为受控读取字节，避免将localhost私有URL交给上游。
- 新SIWC协议、真实原生AES-GCM存储、两服务实例同时刷新一次、失效清理、断开、真实loopback单次回调和所有者复查，共4套19项测试通过。OAuth网络响应使用合成数据，不能称为本人真实授权或真实刷新成功。
- 管理接口本人GET200、API Key403；本地生成尝试→查询PENDING→取消CANCELLED均真实通过，host文件已验证加密。未打开浏览器、未请求上游授权、未取得新Token，连接数量仍0。
- 新设置界面前后端全包TS与相关lint通过；实际页面验收、新SIWC本人授权、其文本/图片/工具/结构化输出及真实刷新仍待完成。

官方依据：[注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[账号与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[OIDC发现](https://auth.openai.com/.well-known/openid-configuration)。必要旧Codex协议参考与MIT许可保留在模块THIRD_PARTY_NOTICES.md。

## 5. 工作区 AI 配置入口

设置 → AI →「订阅与功能」显示当前 Codex 账号从上游读取的剩余额度窗口和重置时间；未知窗口不显示为 100%。手动同步账号模型目录到原生 AI_PROVIDERS，保留其他提供方，不修改现有功能选择。请求使用服务端账号绑定，不返回 OAuth token，也不创建共享反代端点。

业务功能由 `AiFeatureModelsService` 注册：候选人资料整理、岗位 JD 整理、匹配结果文案、人岗匹配评分。前三项读取独立语言模型配置，最后一项只允许原生 evaluation 模型。绑定存入原生 `AI_FEATURE_MODELS`，API 与 worker 共用配置；已有生成 checkpoint 不重跑，新生成使用当前选择。首次未选时保留已有环境变量及 smart 默认模型回退。

「Jev」独立标签支持评分模型选择、当前提供方服务地址和 API Key 更新。空凭据保留原密钥，GET 只返回是否配置；保存走原生敏感配置存储。该页面不包含用量计费平台、账号池或公共 API 分发。

验收：真实当前账号额度查询成功，模型目录返回 5 个模型；四个功能绑定均成功持久化为原有模型，未改变默认选择。浏览器完成 Jev 连接原值保存。当前 Codex 来源不是新的 SIWC 授权验收。

## 6. 客户端版本与目录刷新修正

Codex 路径直接 HTTP 调用，不启动 CLI 进程。本机登录来源读取 auth.json，兼容版本从同目录 models_cache.json 的 client_version 读取；缺失或无效时保留 CLI 兼容版本回退。目录查询和请求头使用相同版本，不能把旧客户端目录误报为当前账号完整模型权限。

2026-11-01 用本机 0.166.0 兼容版本重新请求目录，返回 8 个可显示模型，包含 GPT-6-Astra；过滤 visibility=hide 及 supported_in_api=false 的条目。同步后刷新原生客户端配置；官方模型设置页进入时也刷新，避免继续显示旧标签和旧列表。既有功能模型选择不自动改变。

Jev 页面固定用于 Jev，无模型切换框和内部提供方名称。测试连接按当前表单建立不缓存的临时 Provider，发起一条合成评分，不写配置、不使用招聘资料；只返回成功、耗时和有效分数，失败不泄露上游错误体。真实当前连接返回有效评分 3.99，耗时约 2.7 秒。

## 7. Twenty 自主管理的 Codex OAuth

设置页的「连接 ChatGPT」现在由 Twenty 创建 PKCE/state/nonce，临时监听 localhost:1455 回调，通过 Codex 公共客户端授权取得独立令牌。该流程不启动 CLI，不导入或修改本机 auth.json。它与 SIWC 公共 Responses 连接分开，不将 Codex OAuth 称为 SIWC 授权。

同一原生加密存储保存连接，原生 PG 互斥串行化 API/worker 刷新；刷新返回身份时重新验证签名、用户和账号绑定。无效授权清除可用令牌，临时网络故障不自动换账号。断开清除 Twenty 保存的凭据，撤销上游会话的确认单独报告。

授权完成后，页面先验证真实刷新，再使用独立凭据获取目录、完成一条合成结构化输出。验证通过才切换原有 ChatGPT Provider 到 subscriptionConnectionId；保留业务功能选择。启用后额度、模型目录和推理均从该连接取令牌，不读取本机 Codex 文件。没有独立连接时旧本机来源暂时保留，不能将待授权状态称作已脱离本机。
