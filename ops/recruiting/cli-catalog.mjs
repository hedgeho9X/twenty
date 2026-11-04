/** Presents only the recruiting operator surface; legacy aliases stay out of discovery. */
export const COMMANDS = {
  search: {
    candidates: '<q> [--limit N] [--cursor C] [--json]；搜索候选人',
    companies: '<q> [--limit N] [--cursor C] [--json]；搜索公司',
    jobs: '<q> [--limit N] [--cursor C] [--company-id UUID] [--json]；搜索岗位',
  },
  auth: {
    login: '[--base URL] [--key-stdin]；验证并保存到Keychain',
    logout: '[--base URL]；删除本机凭据，不撤销服务端Key',
    status: '验证当前 API Key 的连接与候选人读取权限',
  },
  companies: {
    search: '--query 名称；搜索公司',
    get: '--id ID；读取公司',
    create: '--name 名称 [--domain 网站] [--description 简介]',
  },
  jobs: {
    list: '[--company-id ID] [--query 关键词]',
    get: '--id ID；读取岗位',
    import:
      '--company-id ID --employment-type full_time|internship --text-file JD.txt --key 请求标识 [--wait]',
    status: '--id ID --status RECRUITING|CLOSED|PAUSED',
  },
  candidates: {
    list: '[--query 关键词]',
    get: '--id ID；读取解析资料',
    reparse:
      '--id ID --batch-id 标识 [--wait]；重新解析已有原件，保留候选人身份',
    files: '--id ID；列出当前有权读取的候选人原件引用',
    download: '--id ID --file-id FILE_ID --out 路径；下载原件，不覆盖已有文件',
    upload:
      '--employment-type full_time|internship --file 简历 [--file 补充材料，合计最多6份] [--note-file 说明] [--candidate-id ID] --key 请求标识 [--wait]',
  },
  tasks: {
    list: '[--offset N]；统一处理队列',
    get: '--id ID [--kind intake|match|draft|mail]',
    wait: '--id ID [--kind intake|match|draft|mail] [--timeout-ms N]',
    retry: '--id ID [--kind intake|match|draft|mail] [--wait]',
  },
  match: {
    results:
      '[--direction CANDIDATE_TO_JOBS|JOB_TO_CANDIDATES] [--query 关键词] [--offset N] [--limit N] [--read read|unread] [--status TODO|TO_CONTACT|CONTACTED|DISMISSED]',
    get: '--id 结果ID；读取全部匹配结果',
    reviewed: '--id 结果ID；标记当前身份已读',
    workflow:
      '--id 结果ID --status TODO|TO_CONTACT|CONTACTED|DISMISSED；更新跟进状态',
    candidate: '--id 候选人ID [--targets 岗位ID,ID] [--key 请求标识] [--wait]',
    job: '--id 岗位ID [--targets 候选人ID,ID] [--key 请求标识] [--wait]',
    pair: '--candidate-id ID --job-id ID [--key 请求标识] [--wait]',
  },
  draft: {
    generate:
      '--match-run-id ID [--top 5|10 或 --selected-ids ID,ID] [--note-file 说明] --key 请求标识 [--wait]',
    get: '--id ID；取得文案与已生成的分享链接',
    edit: '--id ID --data-file draft.json；保存 title/body',
  },
  share: {
    create: '[--job-ids ID,ID] [--candidate-ids ID,ID]；至少一类非空',
    list: '[--query 关键词] [--offset N] [--limit N]；查询分享资料',
    revoke: '--id 短链接末尾标识；立即失效',
  },
};

/** Describes a group or action without requiring an API key. */
export const commandHelp = (group, action) => {
  if (group && !COMMANDS[group])
    throw new Error(`Unknown command group: ${group}`);
  const commands = group
    ? {
        [group]: action
          ? { [action]: COMMANDS[group][action] }
          : COMMANDS[group],
      }
    : COMMANDS;
  if (group && action && !COMMANDS[group][action])
    throw new Error(`Unknown command: ${group} ${action}`);
  return {
    name: 'fanhan',
    auth: 'FANHAN_API_KEY',
    base: 'FANHAN_BASE_URL',
    defaultBase: 'http://localhost:23001',
    commands,
    output:
      'JSON (search: table, or --json); stderr errors; exit 1 request failure, 2 business failure',
    wait: '--wait waits for intake and linked matching; timeout preserves task ID',
  };
};

/** Keeps the shorter public vocabulary compatible with existing API routes. */
export const resolveCommand = (group, action, values) => {
  if (group === 'candidates' && action === 'list')
    return ['subjects', 'candidates'];
  if (group === 'candidates' && action === 'upload')
    return ['resume', 'upload'];
  if (group === 'jobs' && action === 'list') return ['subjects', 'jobs'];
  if (group === 'jobs' && action === 'import') return ['jobs', 'submit'];
  if (group === 'tasks' && action === 'list') return ['queue', 'list'];
  if (group === 'tasks' && action === 'wait') {
    values.wait = true;
    return ['task', 'get'];
  }
  if (group === 'tasks') return ['task', action];
  if (group === 'draft' && action === 'generate') return ['draft', 'matches'];
  return [group, action];
};
