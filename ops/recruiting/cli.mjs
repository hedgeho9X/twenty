import {
  resolveAuth,
  keychain,
  saveConfig,
  readConfig,
  readKey,
  apiOrigin,
} from './cli-auth.mjs';
/** Runs recruiting operations as a thin authenticated API client; credentials come only from the environment. */
import { link, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { commandHelp, resolveCommand } from './cli-catalog.mjs';
import { submitJobMaterials } from './cli-job-upload.mjs';

/** Keeps task paths explicit and rejects unsupported kinds rather than silently selecting a different resource. */
const taskResource = (kind) => {
  const resource = {
    intake: 'resume-intakes',
    match: 'match-runs',
    draft: 'drafts',
    mail: 'mail-archives',
  }[kind];
  if (!resource)
    throw new Error('Task kind must be intake, match, draft or mail');
  return resource;
};

/** Sends one request without following redirects or logging authentication headers. */
export const createRecruitingClient = ({ baseUrl, token, fetcher = fetch }) => {
  const base = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    (base.protocol === 'http:' &&
      process.env.FANHAN_ALLOW_HTTP !== '1' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  )
    throw new Error('Use HTTPS or an explicit local recruiting URL');
  if (!token || !/^[A-Za-z0-9_.-]+$/.test(token))
    throw new Error('Run fanhan auth login or set FANHAN_API_KEY');
  const send = async (path, options = {}) => {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..'))
      throw new Error('Invalid API path');
    return fetcher(`${base.origin}${path}`, {
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
  };
  const json = async (response) => {
    let body;
    try {
      body = await response.json();
    } catch {
      const error = new Error(
        `API returned an empty or invalid JSON body (${response.status})`,
      );
      error.status = response.status;
      error.code = 'INVALID_JSON';
      throw error;
    }
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
  const request = async (path, options = {}) => json(await send(path, options));
  const download = async (path, output) => {
    const response = await send(path);
    if (!response.ok) await json(response);
    if (
      !response.body ||
      response.headers.get('content-type')?.split(';')[0].trim() !==
        'application/octet-stream'
    ) {
      await response.body?.cancel();
      throw new Error('API did not return an original file download');
    }
    const destination = resolve(output);
    let temporary;
    try {
      temporary = await mkdtemp(
        join(dirname(destination), '.fanhan-download-'),
      );
      const partial = join(temporary, 'file');
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(partial, { flags: 'wx', mode: 0o600 }),
      );
      const { size } = await stat(partial);
      // Hard-link publication is atomic and refuses existing files or symlinks.
      await link(partial, destination);
      return { path: destination, bytes: size };
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
      if (!response.body.locked) await response.body.cancel();
    }
  };
  const post = (path, body) =>
    request(`/recruiting/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  return { request, post, download };
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
      `/recruiting/${taskResource(kind)}/${encodeURIComponent(id)}`,
    );
    if (
      kind === 'intake'
        ? value.state === 'NEEDS_REVIEW' ||
          (value.state === 'COMPLETED' && value.matchingStatus !== 'PENDING')
        : !['UPLOADING', 'QUEUED', 'PROCESSING', 'EXPANDING'].includes(
            value.status,
          )
    )
      return value;
    await sleep(intervalMs);
  }
  const error = new Error(
    'Task is still pending after the wait limit; resume with the returned task',
  );
  error.code = 'TASK_TIMEOUT';
  error.task = { kind, id };
  throw error;
};

/** Renders only the search response's public fields and removes terminal controls. */
const searchTable = (resource, page) => {
  const cell = (value) =>
    String(value ?? '').replace(
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,
      ' ',
    );
  const columns =
    resource === 'candidates'
      ? ['ID', 'Name', 'Headline']
      : resource === 'companies'
        ? ['ID', 'Name', 'Domain']
        : ['ID', 'Title', 'Company ID', 'Status'];
  const rows = page.records.map((record) =>
    [
      record.id,
      typeof record.name === 'object' && record.name
        ? [record.name.firstName, record.name.lastName]
            .filter(Boolean)
            .join(' ')
        : record.name,
      ...(resource === 'candidates'
        ? [record.jobTitle]
        : resource === 'companies'
          ? [record.domainName?.primaryLinkUrl]
          : [record.companyId, record.jobStatus]),
    ].map(cell),
  );
  const widths = columns.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const table = rows.length
    ? [columns, ...rows]
        .map((row) =>
          row
            .map((value, index) => value.padEnd(widths[index]))
            .join('  ')
            .trimEnd(),
        )
        .join('\n')
    : 'No matches.';
  return (
    table +
    (page.nextCursor ? `\nNext page: --cursor ${cell(page.nextCursor)}` : '')
  );
};

/** Search accepts values only; command syntax cannot select API fields or filters. */
const searchParameters = (positionals, values) => {
  const resource = positionals[1];
  const q = positionals[2]?.trim();
  if (
    !['candidates', 'companies', 'jobs'].includes(resource) ||
    positionals.length !== 3 ||
    !q ||
    q.length > 100
  )
    throw new Error(
      'Usage: fanhan search candidates|companies|jobs <q> [--limit N] [--cursor C] [--json]',
    );
  const parameters = new URLSearchParams({ q });
  if (values.limit !== undefined) {
    if (
      !/^[1-9]\d*$/.test(values.limit) ||
      !Number.isSafeInteger(Number(values.limit))
    )
      throw new Error('--limit must be a positive integer');
    parameters.set('limit', String(Math.min(Number(values.limit), 50)));
  }
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (values.cursor !== undefined) {
    let valid = false;
    if (/^[A-Za-z0-9_-]{1,256}$/.test(values.cursor)) {
      try {
        const decoded = JSON.parse(
          Buffer.from(values.cursor, 'base64url').toString(),
        );
        valid =
          decoded !== null &&
          typeof decoded === 'object' &&
          Object.keys(decoded).length === 1 &&
          typeof decoded.id === 'string' &&
          uuid.test(decoded.id) &&
          Buffer.from(JSON.stringify({ id: decoded.id })).toString(
            'base64url',
          ) === values.cursor;
      } catch {
        /* Report a bounded validation error below. */
      }
    }
    if (!valid)
      throw new Error('--cursor must be a search cursor returned by the API');
    parameters.set('cursor', values.cursor);
  }
  if (values['company-id'] !== undefined) {
    if (resource !== 'jobs' || !uuid.test(values['company-id']))
      throw new Error('--company-id requires jobs and a UUID');
    parameters.set('companyId', values['company-id']);
  }
  return parameters;
};

/** Prints stable JSON for operations; search additionally supports human tables. */
export const main = async (arguments_ = process.argv.slice(2)) => {
  const { values, positionals } = parseArgs({
    args: arguments_,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      json: { type: 'boolean' },
      limit: { type: 'string' },
      direction: { type: 'string', default: 'CANDIDATE_TO_JOBS' },
      read: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      cursor: { type: 'string' },
      'key-stdin': { type: 'boolean' },
      'match-run-id': { type: 'string' },
      'selected-ids': { type: 'string' },
      'candidate-ids': { type: 'string' },
      'job-ids': { type: 'string' },
      status: { type: 'string' },
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
      'employment-type': { type: 'string' },
      'candidate-id': { type: 'string' },
      'file-id': { type: 'string' },
      out: { type: 'string' },
      'job-id': { type: 'string' },
      id: { type: 'string' },
      kind: { type: 'string', default: 'intake' },
      audience: { type: 'string', default: 'CANDIDATE' },
      days: { type: 'string', default: '7' },
      channel: { type: 'string' },
      key: { type: 'string' },
      'batch-id': { type: 'string' },
      'items-file': { type: 'string' },
      'data-file': { type: 'string' },
      top: { type: 'string', default: '5' },
      targets: { type: 'string' },
      offset: { type: 'string', default: '0' },
      wait: { type: 'boolean', default: false },
      'timeout-ms': { type: 'string', default: '600000' },
      help: { type: 'boolean' },
      version: { type: 'boolean' },
    },
  });
  if (values.version) {
    console.log(
      JSON.parse(
        await readFile(new URL('./package.json', import.meta.url), 'utf8'),
      ).version,
    );
    return;
  }
  if (values.help || !positionals.length || positionals[0] === 'schema') {
    const group = positionals[0] === 'schema' ? positionals[1] : positionals[0];
    const action =
      positionals[0] === 'schema' ? positionals[2] : positionals[1];
    const help = commandHelp(group, action);
    console.log(
      values.json || positionals[0] === 'schema'
        ? JSON.stringify(help)
        : Object.entries(help.commands)
            .flatMap(([name, actions]) =>
              Object.entries(actions).map(
                ([verb, usage]) => `fanhan ${name} ${verb} ${usage}`,
              ),
            )
            .join('\n'),
    );
    return;
  }
  if (positionals[0] === 'search') {
    const parameters = searchParameters(positionals, values);
    const client = createRecruitingClient(await resolveAuth(values.base));
    const result = await client.request(
      `/recruiting/search/${positionals[1]}?${parameters}`,
    );
    console.log(
      values.json
        ? JSON.stringify(result)
        : searchTable(positionals[1], result),
    );
    return;
  }
  values['items-file'] ??= values['data-file'];
  if (
    positionals[0] === 'auth' &&
    ['login', 'logout'].includes(positionals[1])
  ) {
    const config = await readConfig();
    const baseUrl = apiOrigin(
      values.base ??
        process.env.FANHAN_BASE_URL ??
        process.env.TWENTY_BASE_URL ??
        config.baseUrl ??
        'http://localhost:23001',
    );
    if (positionals[1] === 'logout') {
      await keychain.delete(baseUrl);
      console.log(
        JSON.stringify({
          loggedOut: true,
          baseUrl,
          environmentOverride: Boolean(
            process.env.FANHAN_API_KEY ?? process.env.TWENTY_API_KEY,
          ),
        }),
      );
      return;
    }
    const token = values['key-stdin']
      ? await readKey()
      : (process.env.FANHAN_API_KEY ??
        process.env.TWENTY_API_KEY ??
        (await readKey()));
    await createRecruitingClient({ baseUrl, token }).request(
      '/recruiting/candidates',
    );
    await keychain.set(baseUrl, token);
    await saveConfig(baseUrl);
    console.log(JSON.stringify({ saved: true, baseUrl, storage: 'keychain' }));
    return;
  }
  const auth = await resolveAuth(values.base);
  const client = createRecruitingClient(auth);
  const [group, action] = resolveCommand(
    positionals[0],
    positionals[1],
    values,
  );
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
  if (
    action === 'get' &&
    ['companies', 'candidates', 'jobs', 'draft'].includes(group)
  ) {
    const resource = group === 'draft' ? 'drafts' : group;
    result = await client.request(
      `/recruiting/${resource}/${encodeURIComponent(required('id'))}`,
    );
  } else if (group === 'candidates' && action === 'reparse') {
    result = await client.post(
      `candidates/${encodeURIComponent(required('id'))}/reparse`,
      { batchKey: required('batch-id'), ...(text ? { text } : {}) },
    );
    taskKind = 'intake';
    taskId = result.intakeId;
  } else if (group === 'match' && action === 'results') {
    if (!['CANDIDATE_TO_JOBS', 'JOB_TO_CANDIDATES'].includes(values.direction))
      throw new Error('Invalid --direction');
    if (values.read && !['read', 'unread'].includes(values.read))
      throw new Error('Invalid --read');
    if (
      values.status &&
      !['TODO', 'TO_CONTACT', 'CONTACTED', 'DISMISSED'].includes(values.status)
    )
      throw new Error('Invalid --status');
    const offset = Number(values.offset),
      limit = Number(values.limit ?? 50);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('Use nonnegative --offset and --limit 1..100');
    const parameters = new URLSearchParams({
      direction: values.direction,
      offset: String(offset),
      limit: String(limit),
      search: values.query ?? '',
      read: values.read ?? '',
      followUp: values.status ?? '',
      from: values.from ?? '',
      to: values.to ?? '',
    });
    result = await client.request(`/recruiting/match-results?${parameters}`);
  } else if (
    group === 'match' &&
    ['get', 'reviewed', 'workflow'].includes(action)
  ) {
    const path = `match-runs/${encodeURIComponent(required('id'))}`;
    if (
      action === 'workflow' &&
      !['TODO', 'TO_CONTACT', 'CONTACTED', 'DISMISSED'].includes(values.status)
    )
      throw new Error('Invalid --status');
    result =
      action === 'get'
        ? await client.request(`/recruiting/${path}`)
        : await client.post(
            `${path}/${action}`,
            action === 'workflow' ? { status: values.status } : {},
          );
  } else if (group === 'candidates' && action === 'files') {
    result = await client.request(
      `/recruiting/candidates/${encodeURIComponent(required('id'))}/files`,
    );
  } else if (group === 'candidates' && action === 'download') {
    result = await client.download(
      `/recruiting/candidates/${encodeURIComponent(required('id'))}/files/${encodeURIComponent(required('file-id'))}`,
      required('out'),
    );
  } else if (group === 'auth' && action === 'status') {
    await client.request('/recruiting/candidates');
    result = {
      authenticated: true,
      canReadCandidates: true,
      baseUrl: auth.baseUrl,
      source: auth.source,
    };
  } else if (group === 'share' && action === 'list') {
    const offset = Number(values.offset),
      limit = Number(values.limit ?? 50);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('Use nonnegative --offset and --limit 1..100');
    result = await client.request(
      `/recruiting/share-results?${new URLSearchParams({ search: values.query ?? '', offset: String(offset), limit: String(limit) })}`,
    );
  } else if (group === 'share' && action === 'create')
    result = await client.post('share-links', {
      jobIds: (values['job-ids'] ?? '').split(',').filter(Boolean),
      candidateIds: (values['candidate-ids'] ?? '').split(',').filter(Boolean),
    });
  else if (group === 'share' && action === 'revoke')
    result = await client.post(
      `share-links/${encodeURIComponent(required('id'))}/revoke`,
      {},
    );
  else if (group === 'jobs' && action === 'status') {
    const status = required('status');
    if (!['RECRUITING', 'CLOSED', 'PAUSED'].includes(status))
      throw new Error('status must be RECRUITING, CLOSED or PAUSED');
    result = await client.request(
      `/rest/recruitmentJobs/${encodeURIComponent(required('id'))}`,
      { method: 'PATCH', body: JSON.stringify({ jobStatus: status }) },
    );
  } else if (group === 'draft' && action === 'matches') {
    let selectedIds = values['selected-ids']?.split(',').filter(Boolean);
    if (!selectedIds) {
      const run = await client.request(
        `/recruiting/match-runs/${encodeURIComponent(required('match-run-id'))}`,
      );
      if (!run.complete)
        throw new Error('Match is not complete; wait or retry its task first');
      const top = Number(values.top);
      if (!Number.isInteger(top) || top < 1 || top > 10)
        throw new Error('--top must be an integer from 1 to 10');
      selectedIds = run.top
        .slice(0, top)
        .map((pair) =>
          run.direction === 'JOB_TO_CANDIDATES' ? pair.candidateId : pair.jobId,
        );
      if (!selectedIds.length)
        throw new Error('No matched results are available for a draft');
    }
    result = await client.post('drafts', {
      kind: 'GREETING',
      matchRunId: required('match-run-id'),
      selectedIds,
      note,
      idempotencyKey: key,
    });
    taskKind = 'draft';
    taskId = result.draftId;
  } else if (group === 'companies' && action === 'search')
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
  else if (group === 'activity' && action === 'note')
    result = await client.post('activities', {
      action: 'NOTE',
      candidateId: required('candidate-id'),
      jobId: values['job-id'],
      note: note ?? required('note'),
      channel: values.channel,
      idempotencyKey: key,
    });
  else if (group === 'activity' && action === 'list')
    result = await client.request(
      `/recruiting/activities?offset=${Number(values.offset) || 0}${values['candidate-id'] ? `&candidateId=${encodeURIComponent(values['candidate-id'])}` : ''}`,
    );
  else if (group === 'portal' && action === 'create')
    result = await client.post('portal-invites', {
      kind: values.audience,
      candidateId: required('candidate-id'),
      jobIds: values.targets
        ? values.targets.split(',').filter(Boolean)
        : values['job-id']
          ? [values['job-id']]
          : [],
      expiresInDays: Number(values.days),
      idempotencyKey: key,
    });
  else if (group === 'portal' && action === 'list')
    result = await client.request(
      `/recruiting/portal-invites?offset=${Number(values.offset) || 0}`,
    );
  else if (group === 'portal' && ['link', 'revoke'].includes(action))
    result = await client.post(
      `portal-invites/${encodeURIComponent(required('id'))}/${action}`,
      {},
    );
  else if (group === 'portal' && action === 'status')
    result = await client.request(
      `/recruiting/sharing-status?candidateId=${encodeURIComponent(required('candidate-id'))}&jobId=${encodeURIComponent(required('job-id'))}`,
    );
  else if (group === 'mail' && action === 'import') {
    if (values.file?.length !== 1)
      throw new Error('mail import takes one complete EML file');
    const filename = resolve(values.file[0]);
    const form = new FormData();
    form.append(
      'file',
      new Blob([await readFile(filename)]),
      basename(filename),
    );
    result = await client.request('/recruiting/mail-archives/upload', {
      method: 'POST',
      body: form,
    });
    taskKind = 'mail';
    taskId = result.archiveId;
  } else if (group === 'mail' && action === 'select') {
    result = await client.post(
      `mail-archives/${encodeURIComponent(required('id'))}/intakes`,
      JSON.parse(await readFile(resolve(required('items-file')), 'utf8')),
    );
    taskKind = 'intake';
    taskId = result.intakeId;
  } else if (
    group === 'draft' &&
    ['greeting', 'publication'].includes(action)
  ) {
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
    if (!values.file?.length || values.file.length > 6)
      throw new Error('Upload 1 to 6 files for the same candidate');
    const employmentType = required('employment-type');
    if (!['full_time', 'internship'].includes(employmentType))
      throw new Error('Use --employment-type full_time|internship');
    const form = new FormData();
    form.append('employmentType', employmentType);
    for (const filename of values.file) {
      const filePath = resolve(filename);
      form.append(
        'file',
        new Blob([await readFile(filePath)]),
        basename(filePath),
      );
    }
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
    if (positionals[1] === 'import' && values.file?.length)
      throw new Error('JD import uses --text-file, not uploaded documents');
    const employmentType = required('employment-type');
    if (!['full_time', 'internship'].includes(employmentType))
      throw new Error('Use --employment-type full_time|internship');
    result = await submitJobMaterials({
      client,
      filenames: values.file ?? [],
      baseUrl: auth.baseUrl,
      token: auth.token,
      persistent: Boolean(values.key),
      request: {
        companyId: required('company-id'),
        employmentType,
        text,
        note,
        source: 'api',
        idempotencyKey: key,
        batchId: values['batch-id'],
      },
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
    const path = `${taskResource(kind)}/${encodeURIComponent(required('id'))}`;
    result =
      action === 'retry'
        ? await client.post(`${path}/retry`, {})
        : await client.request(`/recruiting/${path}`);
    taskKind = kind;
    taskId = values.id;
  } else if (group === 'queue' && action === 'list')
    result = await client.request(
      `/recruiting/${arguments_.some((arg) => arg === '--kind' || arg.startsWith('--kind=')) ? taskResource(values.kind) : 'processing-tasks'}?offset=${Number(values.offset) || 0}`,
    );
  else throw new Error('Unknown command; run with --help');
  if (values.wait && taskId) {
    const timeoutMs = Number(values['timeout-ms']);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
      throw new Error('--timeout-ms must be a nonnegative number');
    const started = Date.now();
    result = await waitForRecruitingTask(client, taskKind, taskId, {
      timeoutMs,
    });
    if (
      taskKind === 'intake' &&
      result.state === 'COMPLETED' &&
      (result.matchingRunIds?.length ||
        result.items?.some((item) => item.matchingRunId))
    ) {
      result.matchingResults = [];
      for (const id of new Set([
        ...(result.matchingRunIds ?? []),
        ...(result.items ?? [])
          .map((item) => item.matchingRunId)
          .filter(Boolean),
      ]))
        result.matchingResults.push(
          await waitForRecruitingTask(client, 'match', id, {
            timeoutMs: Math.max(0, timeoutMs - (Date.now() - started)),
          }),
        );
    }
  }
  console.log(JSON.stringify(result));
  if (
    result.status === 'PARTIAL' ||
    result.status === 'FAILED' ||
    result.stage === 'FAILED' ||
    result.stage === 'CONFIRMATION_PARTIAL' ||
    result.state === 'NEEDS_REVIEW' ||
    ['FAILED_TO_QUEUE', 'PARTIAL'].includes(result.matchingStatus) ||
    result.matchingResults?.some((run) =>
      ['FAILED', 'PARTIAL'].includes(run.status),
    )
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
        code: error.code,
        task: error.task,
        ...(error.status ? { status: error.status } : {}),
      }),
    );
    process.exitCode = 1;
  });
}
