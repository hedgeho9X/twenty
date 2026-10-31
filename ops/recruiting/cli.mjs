/** Runs recruiting operations as a thin authenticated API client; credentials come only from the environment. */
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

/** Sends one request without following redirects or logging authentication headers. */
export const createRecruitingClient = ({ baseUrl, token, fetcher = fetch }) => {
  const base = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  )
    throw new Error('Use HTTPS or an explicit local recruiting URL');
  if (!token || !/^[A-Za-z0-9_.-]+$/.test(token))
    throw new Error('Set a valid TWENTY_API_KEY environment variable');
  const request = async (path, options = {}) => {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..'))
      throw new Error('Invalid API path');
    const response = await fetcher(`${base.origin}${path}`, {
      ...options,
      redirect: 'error',
      signal: options.signal ?? AbortSignal.timeout(120_000),
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { 'content-type': 'application/json' }),
        ...options.headers,
        authorization: `Bearer ${token}`,
      },
    });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(
        (typeof body.message === 'string'
          ? body.message
          : `API request failed (${response.status})`
        ).replaceAll(token, '[REDACTED]'),
      );
      error.status = response.status;
      throw error;
    }
    return body;
  };
  const post = (path, body) =>
    request(`/recruiting/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  return { request, post };
};

/** Waits for durable business state, treating partial and failed work distinctly from a successful HTTP response. */
export const waitForRecruitingTask = async (
  client,
  kind,
  id,
  {
    timeoutMs = 600_000,
    intervalMs = 2000,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {},
) => {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const value = await client.request(
      `/recruiting/${kind === 'intake' ? 'resume-intakes' : kind === 'draft' ? 'drafts' : 'match-runs'}/${encodeURIComponent(id)}`,
    );
    if (
      kind === 'intake'
        ? ['COMPLETED', 'NEEDS_REVIEW'].includes(value.state)
        : !['QUEUED', 'PROCESSING'].includes(value.status)
    )
      return value;
    await sleep(intervalMs);
  }
  throw new Error(
    'Task is still pending after the wait limit; query its ID again',
  );
};

/** Prints stable JSON only; file bytes and credentials never become command-line arguments. */
export const main = async (arguments_ = process.argv.slice(2)) => {
  const { values, positionals } = parseArgs({
    args: arguments_,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      file: { type: 'string', multiple: true },
      name: { type: 'string' },
      domain: { type: 'string' },
      description: { type: 'string' },
      query: { type: 'string' },
      text: { type: 'string' },
      'text-file': { type: 'string' },
      note: { type: 'string' },
      'note-file': { type: 'string' },
      'company-id': { type: 'string' },
      'candidate-id': { type: 'string' },
      'job-id': { type: 'string' },
      id: { type: 'string' },
      kind: { type: 'string', default: 'intake' },
      key: { type: 'string' },
      'batch-id': { type: 'string' },
      'items-file': { type: 'string' },
      targets: { type: 'string' },
      offset: { type: 'string', default: '0' },
      wait: { type: 'boolean', default: false },
      'timeout-ms': { type: 'string', default: '600000' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || !positionals.length) {
    console.log(
      'Recruiting CLI: companies search|create; subjects candidates|jobs; resume upload; jobs submit|confirm; match candidate|job|pair; draft greeting|publication|edit; task get|retry; queue list. Task kind: intake|match|draft. Draft generation never sends or publishes. Use --base or TWENTY_BASE_URL and TWENTY_API_KEY; --file may repeat, --note-file/--text-file preserve full materials; --wait queries durable state.',
    );
    return;
  }
  const client = createRecruitingClient({
    baseUrl:
      values.base ?? process.env.TWENTY_BASE_URL ?? 'http://localhost:23001',
    token: process.env.TWENTY_API_KEY,
  });
  const [group, action] = positionals;
  const note = values['note-file']
    ? await readFile(resolve(values['note-file']), 'utf8')
    : values.note;
  const text = values['text-file']
    ? await readFile(resolve(values['text-file']), 'utf8')
    : values.text;
  const key = values.key ?? randomUUID();
  const required = (name) => {
    const value = values[name];
    if (!value) throw new Error(`--${name} is required`);
    return value;
  };
  let result;
  let taskKind;
  let taskId;
  if (group === 'companies' && action === 'search')
    result = await client.request(
      `/recruiting/companies?search=${encodeURIComponent(values.query ?? '')}&offset=${Number(values.offset) || 0}`,
    );
  else if (group === 'companies' && action === 'create')
    result = await client.post('companies', {
      name: required('name'),
      domain: values.domain,
      description: values.description,
    });
  else if (group === 'subjects' && ['candidates', 'jobs'].includes(action))
    result = await client.request(
      `/recruiting/${action}?search=${encodeURIComponent(values.query ?? '')}${values['company-id'] ? `&companyId=${encodeURIComponent(values['company-id'])}` : ''}`,
    );
  else if (group === 'draft' && ['greeting', 'publication'].includes(action)) {
    result = await client.post('drafts', {
      kind: action === 'greeting' ? 'GREETING' : 'JOB_PUBLICATION',
      candidateId: action === 'greeting' ? required('candidate-id') : undefined,
      jobId: action === 'publication' ? required('job-id') : values['job-id'],
      note,
      idempotencyKey: key,
    });
    taskKind = 'draft';
    taskId = result.draftId;
  } else if (group === 'draft' && action === 'edit')
    result = await client.post(
      `drafts/${encodeURIComponent(required('id'))}/review`,
      JSON.parse(await readFile(resolve(required('items-file')), 'utf8')),
    );
  else if (group === 'resume' && action === 'upload') {
    if (values.file?.length !== 1)
      throw new Error(
        'resume upload takes one file; use one invocation per candidate',
      );
    const filePath = resolve(values.file[0]);
    const form = new FormData();
    form.append(
      'file',
      new Blob([await readFile(filePath)]),
      basename(filePath),
    );
    if (note !== undefined) form.append('note', note);
    if (values['candidate-id'])
      form.append('candidateId', values['candidate-id']);
    if (values['batch-id']) form.append('batchId', values['batch-id']);
    result = await client.request('/recruiting/resume-intakes/upload', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: form,
    });
    taskKind = 'intake';
    taskId = result.intakeId;
  } else if (group === 'jobs' && action === 'submit') {
    const files = [];
    for (const filename of values.file ?? []) {
      const bytes = await readFile(resolve(filename));
      const target = await client.post('uploads/targets', {
        filename: basename(filename),
        size: bytes.length,
      });
      const uploadUrl = new URL(target.uploadUrl);
      if (!['https:', 'http:'].includes(uploadUrl.protocol))
        throw new Error('Invalid upload target');
      const uploaded = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': target.contentType },
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
      });
      if (!uploaded.ok) throw new Error(`Upload failed (${uploaded.status})`);
      files.push(
        await client.post('uploads/complete', {
          uploadReceipt: target.uploadReceipt,
        }),
      );
    }
    result = await client.post('job-intakes', {
      companyId: required('company-id'),
      files,
      text,
      note,
      source: 'api',
      idempotencyKey: key,
      batchId: values['batch-id'],
    });
    taskKind = 'intake';
    taskId = result.intakeId;
  } else if (group === 'jobs' && action === 'confirm')
    result = await client.post(
      `job-intakes/${encodeURIComponent(required('id'))}/confirm`,
      JSON.parse(await readFile(resolve(required('items-file')), 'utf8')),
    );
  else if (group === 'match' && ['candidate', 'job', 'pair'].includes(action)) {
    result = await client.post('match-runs', {
      direction:
        action === 'candidate'
          ? 'CANDIDATE_TO_JOBS'
          : action === 'job'
            ? 'JOB_TO_CANDIDATES'
            : 'PAIR',
      subjectId: action === 'pair' ? required('candidate-id') : required('id'),
      ...(action === 'pair' ? { jobId: required('job-id') } : {}),
      ...(values.targets
        ? { targetIds: values.targets.split(',').filter(Boolean) }
        : {}),
      idempotencyKey: key,
    });
    taskKind = 'match';
    taskId = result.runId;
  } else if (group === 'task' && ['get', 'retry'].includes(action)) {
    const kind = values.kind;
    if (!['intake', 'match', 'draft'].includes(kind))
      throw new Error('--kind must be intake, match or draft');
    const path = `${kind === 'intake' ? 'resume-intakes' : kind === 'draft' ? 'drafts' : 'match-runs'}/${encodeURIComponent(required('id'))}`;
    result =
      action === 'retry'
        ? await client.post(`${path}/retry`, {})
        : await client.request(`/recruiting/${path}`);
    taskKind = kind;
    taskId = values.id;
  } else if (group === 'queue' && action === 'list')
    result = await client.request(
      `/recruiting/${values.kind === 'match' ? 'match-runs' : values.kind === 'draft' ? 'drafts' : 'resume-intakes'}?offset=${Number(values.offset) || 0}`,
    );
  else throw new Error('Unknown command; run with --help');
  if (values.wait && taskId)
    result = await waitForRecruitingTask(client, taskKind, taskId, {
      timeoutMs: Number(values['timeout-ms']),
    });
  console.log(JSON.stringify(result));
  if (
    result.status === 'PARTIAL' ||
    result.status === 'FAILED' ||
    result.stage === 'FAILED' ||
    result.stage === 'CONFIRMATION_PARTIAL'
  )
    process.exitCode = 2;
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        error: error.message,
        ...(error.status ? { status: error.status } : {}),
      }),
    );
    process.exitCode = 1;
  });
}
