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
