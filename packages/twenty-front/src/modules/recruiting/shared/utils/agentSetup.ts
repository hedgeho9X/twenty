/** Defines the versioned public artifacts and copyable Agent onboarding instructions. */
export const FANHAN_RELEASE_URL =
  'https://github.com/hedgeho9X/twenty/releases/download/fanhan-cli-v0.3.0';

/** Supports HTTP test or self-hosted origins, where the Clipboard API is unavailable. */
export const copyFanhanAgentPrompt = async (text: string) => {
  if (navigator.clipboard?.writeText)
    return navigator.clipboard.writeText(text);
  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    field.remove();
  }
};

/** Keeps the service origin and optional newly issued key in the user's clipboard only. */
export const buildFanhanAgentPrompt = (baseUrl: string, apiKey?: string) =>
  `请作为泛函招聘助理，使用 fanhan CLI 和配套 skill 完成招聘运营任务。
服务地址：${baseUrl}
${baseUrl.startsWith('http:') ? '此入口使用 HTTP：运行 CLI 时设置 FANHAN_ALLOW_HTTP=1；切换 HTTPS 后取消该设置。' : ''}
API Key：${apiKey || '请向我索取已有 API Key；不要重新生成或撤销其他 Key。'}

CLI 下载：${FANHAN_RELEASE_URL}/fanhan-cli.tgz
Skill 下载：${FANHAN_RELEASE_URL}/fanhan-recruiting-skill.zip
校验文件：${FANHAN_RELEASE_URL}/SHA256SUMS

需要 Node.js 22 或更新版本。下载并校验后安装 CLI，将 skill 解压到当前 Agent 的 skills 目录并阅读 SKILL.md。
macOS 可通过 fanhan auth login 保存凭据；Linux/CI 使用 FANHAN_BASE_URL、FANHAN_API_KEY 环境变量。不要把 Key 放进命令参数、代码或日志。
先运行 fanhan auth status --json 确认连接，再按需查看 fanhan <命令组> --help。
操作公司、文字 JD、同一候选人的简历材料、处理任务、匹配、推荐文案和分享链接；正式或实习须明确标注。
先确认我的具体招聘任务再写入数据。生成文案不等于发送，不要声称已联系候选人或公司。`;
