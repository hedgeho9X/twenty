/** Checks credential handling and asynchronous receipts without consuming models or mutating a workspace. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecruitingClient, waitForRecruitingTask } from './cli.mjs';
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiOrigin } from './cli-auth.mjs';

test('candidate files/download commands preserve original bytes and explicit output paths', async () => {
  const { main } = await import('./cli.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'fanhan-download-'));
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FANHAN_API_KEY;
  const originalLog = console.log;
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0xff, 0x0a]);
  const output = join(directory, '简历.pdf');
  const logs = [];
  const requests = [];
  process.env.FANHAN_API_KEY = 'test-key';
  console.log = (value) => logs.push(JSON.parse(value));
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer test-key');
    assert.ok(options.signal instanceof AbortSignal);
    return url.endsWith('/files')
      ? Response.json({
          candidateId: 'candidate',
          files: [{ fileId: 'resume', label: '../../remote-name.pdf' }],
        })
      : new Response(bytes, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition':
              'attachment; filename="../../remote-name.pdf"',
          },
        });
  };
  try {
    const base = ['--base', 'http://127.0.0.1:23001'];
    await main(['candidates', 'files', ...base, '--id', 'candidate', '--json']);
    assert.deepEqual(logs[0].files, [
      { fileId: 'resume', label: '../../remote-name.pdf' },
    ]);
    await main([
      'candidates',
      'download',
      ...base,
      '--id',
      'candidate',
      '--file-id',
      'resume',
      '--out',
      output,
      '--json',
    ]);
    assert.deepEqual(logs[1], { path: output, bytes: bytes.length });
    assert.deepEqual(await readFile(output), bytes);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(directory), ['简历.pdf']);
    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        'http://127.0.0.1:23001/recruiting/candidates/candidate/files',
        'http://127.0.0.1:23001/recruiting/candidates/candidate/files/resume',
      ],
    );
    for (const missing of [
      ['--file-id', 'resume'],
      ['--out', output],
    ]) {
      await assert.rejects(
        main([
          'candidates',
          'download',
          ...base,
          '--id',
          'candidate',
          ...missing,
        ]),
        /is required/,
      );
    }
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalKey === undefined) delete process.env.FANHAN_API_KEY;
    else process.env.FANHAN_API_KEY = originalKey;
    await rm(directory, { recursive: true, force: true });
  }
});

test('downloads reject authorization errors, redirects and unexpected JSON without saving files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fanhan-download-errors-'));
  const token = 'test-private-token';
  const path = '/recruiting/candidates/candidate/files/resume';
  try {
    for (const status of [403, 404, 302]) {
      let calls = 0;
      const client = createRecruitingClient({
        baseUrl: 'https://example.test',
        token,
        fetcher: async (url, options) => {
          calls++;
          assert.equal(url, `https://example.test${path}`);
          assert.equal(options.redirect, 'error');
          return Response.json(
            { message: `Denied ${token}` },
            {
              status,
              headers: { location: 'https://elsewhere.test/file' },
            },
          );
        },
      });
      await assert.rejects(
        client.download(path, join(directory, 'original.pdf')),
        (error) => error.status === status && !error.message.includes(token),
      );
      assert.equal(calls, 1);
      await assert.rejects(client.download('//elsewhere.test/file', 'unused'));
      assert.equal(calls, 1);
    }
    const client = createRecruitingClient({
      baseUrl: 'https://example.test',
      token,
      fetcher: async () => Response.json({ message: 'not a file' }),
    });
    await assert.rejects(
      client.download(path, join(directory, 'original.pdf')),
      /original file download/,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('downloads refuse existing files and symlinks and remove partial transfers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fanhan-download-cleanup-'));
  const path = '/recruiting/candidates/candidate/files/resume';
  const original = join(directory, 'existing.pdf');
  const shortcut = join(directory, 'symlink.pdf');
  const client = createRecruitingClient({
    baseUrl: 'https://example.test',
    token: 'test',
    fetcher: async () =>
      new Response('replacement', {
        headers: { 'content-type': 'application/octet-stream' },
      }),
  });
  try {
    await writeFile(original, 'keep');
    await symlink(original, shortcut);
    for (const output of [original, shortcut]) {
      await assert.rejects(client.download(path, output), { code: 'EEXIST' });
      assert.equal(await readFile(original, 'utf8'), 'keep');
    }
    let chunks = 0;
    const failing = createRecruitingClient({
      baseUrl: 'https://example.test',
      token: 'test',
      fetcher: async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (chunks++ === 0) controller.enqueue(new Uint8Array([1, 2, 3]));
              else controller.error(new Error('interrupted transfer'));
            },
          }),
          { headers: { 'content-type': 'application/octet-stream' } },
        ),
    });
    await assert.rejects(
      failing.download(path, join(directory, 'partial.pdf')),
      /interrupted transfer/,
    );
    assert.deepEqual((await readdir(directory)).sort(), [
      'existing.pdf',
      'symlink.pdf',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('remote HTTP requires explicit opt-in and still rejects embedded credentials', () => {
  const original = process.env.FANHAN_ALLOW_HTTP;
  try {
    delete process.env.FANHAN_ALLOW_HTTP;
    assert.equal(apiOrigin('https://43.136.55.30'), 'https://43.136.55.30');
    assert.throws(() => apiOrigin('http://43.136.55.30'));
    process.env.FANHAN_ALLOW_HTTP = '1';
    assert.equal(apiOrigin('http://43.136.55.30'), 'http://43.136.55.30');
    assert.doesNotThrow(() =>
      createRecruitingClient({
        baseUrl: 'http://43.136.55.30',
        token: 'synthetic',
      }),
    );
    assert.throws(() => apiOrigin('http://secret@43.136.55.30'));
  } finally {
    if (original === undefined) delete process.env.FANHAN_ALLOW_HTTP;
    else process.env.FANHAN_ALLOW_HTTP = original;
  }
});

test('client never accepts a remote plaintext endpoint or embedded credentials', () => {
  assert.throws(() =>
    createRecruitingClient({ baseUrl: 'http://example.com', token: 'test' }),
  );
  assert.throws(() =>
    createRecruitingClient({
      baseUrl: 'https://user:password@example.com',
      token: 'test',
    }),
  );
  assert.throws(() =>
    createRecruitingClient({
      baseUrl: 'http://localhost:23001',
      token: 'bad\nheader',
    }),
  );
});

test('client retains redirect protection and redacts credentials from server errors', async () => {
  const token = 'test-private-token';
  const client = createRecruitingClient({
    baseUrl: 'http://localhost:23001',
    token,
    fetcher: async (_url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      return Response.json({ message: `Denied ${token}` }, { status: 403 });
    },
  });
  await assert.rejects(
    client.request('/recruiting/companies'),
    (error) => error.status === 403 && !error.message.includes(token),
  );
});

test('multipart client lets fetch generate its own boundary', async () => {
  const form = new FormData();
  form.append('note', '说明');
  const client = createRecruitingClient({
    baseUrl: 'http://localhost:23001',
    token: 'test',
    fetcher: async (_url, options) => {
      assert.equal(options.headers['content-type'], undefined);
      return Response.json({ intakeId: 'intake' });
    },
  });
  assert.equal(
    (
      await client.request('/recruiting/resume-intakes/upload', {
        method: 'POST',
        body: form,
      })
    ).intakeId,
    'intake',
  );
});

test('waiting follows business state and returns partial coverage without claiming success', async () => {
  const states = [
    { status: 'QUEUED' },
    { status: 'PROCESSING' },
    { status: 'PARTIAL', counts: { failed: 1 } },
  ];
  let calls = 0;
  const result = await waitForRecruitingTask(
    { request: async () => states[calls++] },
    'match',
    'id',
    { sleep: async () => {} },
  );
  assert.equal(calls, 3);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.counts.failed, 1);
});

test('JD preview is a terminal intake phase requiring explicit confirmation', async () => {
  const value = { state: 'NEEDS_REVIEW', stage: 'AWAITING_CONFIRMATION' };
  assert.equal(
    await waitForRecruitingTask({ request: async () => value }, 'intake', 'id'),
    value,
  );
});

test('mail waiting includes MIME expansion and stops at explicit material selection', async () => {
  const states = [
    { status: 'UPLOADING' },
    { status: 'QUEUED' },
    { status: 'EXPANDING' },
    { status: 'NEEDS_SELECTION' },
  ];
  let calls = 0;
  const value = await waitForRecruitingTask(
    {
      request: async (path) => {
        assert.equal(path, '/recruiting/mail-archives/mail');
        return states[calls++];
      },
    },
    'mail',
    'mail',
    { sleep: async () => {} },
  );
  assert.equal(value.status, 'NEEDS_SELECTION');
  assert.equal(calls, 4);
});

test('unified queue, selected-result drafts and share revocation use the business API', async () => {
  const { main } = await import('./cli.mjs');
  const oldFetch = globalThis.fetch,
    oldLog = console.log,
    oldKey = process.env.FANHAN_API_KEY;
  const calls = [];
  process.env.FANHAN_API_KEY = 'test-key';
  console.log = () => {};
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      body: options.body ? JSON.parse(options.body) : undefined,
    });
    return Response.json({ draftId: 'draft', deleted: true });
  };
  try {
    await main(['queue', 'list', '--json']);
    assert.ok(calls.at(-1).url.includes('/processing-tasks?'));
    await main([
      'draft',
      'matches',
      '--match-run-id',
      'run',
      '--selected-ids',
      'a,b',
      '--key',
      'stable',
    ]);
    assert.deepEqual(calls.at(-1).body.selectedIds, ['a', 'b']);
    assert.equal(calls.at(-1).body.matchRunId, 'run');
    await main(['share', 'revoke', '--id', 'opaque']);
    assert.ok(calls.at(-1).url.endsWith('/share-links/opaque/revoke'));
  } finally {
    globalThis.fetch = oldFetch;
    console.log = oldLog;
    if (oldKey === undefined) delete process.env.FANHAN_API_KEY;
    else process.env.FANHAN_API_KEY = oldKey;
  }
});

test('successful HTTP with empty JSON is not reported as success', async () => {
  const client = createRecruitingClient({
    baseUrl: 'http://localhost:23001',
    token: 'test',
    fetcher: async () => new Response(null, { status: 200 }),
  });
  await assert.rejects(
    client.request('/recruiting/candidates'),
    (error) => error.code === 'INVALID_JSON',
  );
});

test('intake wait includes the matching enqueue checkpoint', async () => {
  const states = [
    { state: 'COMPLETED', matchingStatus: 'PENDING' },
    { state: 'COMPLETED', matchingStatus: 'QUEUED', matchingRunIds: ['run'] },
  ];
  const result = await waitForRecruitingTask(
    { request: async () => states.shift() },
    'intake',
    'input',
    { sleep: async () => {} },
  );
  assert.equal(result.matchingStatus, 'QUEUED');
});

test('group help is compact and never needs credentials', async () => {
  const { main } = await import('./cli.mjs');
  const log = console.log;
  let result;
  console.log = (value) => {
    result = JSON.parse(value);
  };
  try {
    await main(['candidates', '--help', '--json']);
    assert.deepEqual(Object.keys(result.commands), ['candidates']);
    assert.ok(result.commands.candidates.upload);
  } finally {
    console.log = log;
  }
});

test('public command aliases read a candidate and default the shortlist to five', async () => {
  const { main } = await import('./cli.mjs');
  const oldFetch = globalThis.fetch,
    log = console.log,
    key = process.env.FANHAN_API_KEY;
  const requests = [];
  console.log = () => {};
  process.env.FANHAN_API_KEY = 'test';
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json(
      url.endsWith('/match-runs/run')
        ? {
            complete: true,
            direction: 'CANDIDATE_TO_JOBS',
            top: Array.from({ length: 10 }, (_, i) => ({ jobId: `job-${i}` })),
          }
        : { draftId: 'draft' },
    );
  };
  try {
    await main(['candidates', 'get', '--id', 'person']);
    assert.ok(requests[0].url.endsWith('/candidates/person'));
    await main(['draft', 'generate', '--match-run-id', 'run', '--key', 'test']);
    assert.equal(
      JSON.parse(requests.at(-1).options.body).selectedIds.length,
      5,
    );
  } finally {
    globalThis.fetch = oldFetch;
    console.log = log;
    if (key === undefined) delete process.env.FANHAN_API_KEY;
    else process.env.FANHAN_API_KEY = key;
  }
});

test('candidate upload requires employment and sends six documents in one request', async () => {
  const { main } = await import('./cli.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'fanhan-six-files-'));
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FANHAN_API_KEY;
  const originalLog = console.log;
  const requests = [];
  process.env.FANHAN_API_KEY = 'synthetic';
  console.log = () => {};
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ intakeId: 'synthetic-intake' });
  };
  try {
    const file = join(directory, 'resume.txt');
    await writeFile(file, 'Synthetic candidate only');
    const base = ['candidates', 'upload', '--base', 'http://127.0.0.1:23001'];
    await assert.rejects(main([...base, '--file', file]), /employment-type/);
    const files = Array.from({ length: 6 }, () => ['--file', file]).flat();
    await main([...base, ...files, '--employment-type', 'internship']);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.body.getAll('file').length, 6);
    assert.equal(requests[0].options.body.get('employmentType'), 'internship');
    await assert.rejects(
      main([
        ...base,
        ...files,
        '--file',
        file,
        '--employment-type',
        'full_time',
      ]),
      /1 to 6/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalKey === undefined) delete process.env.FANHAN_API_KEY;
    else process.env.FANHAN_API_KEY = originalKey;
    await rm(directory, { recursive: true, force: true });
  }
});

const searchCursor = Buffer.from(
  JSON.stringify({
    id: '00000000-0000-4000-8000-000000000001',
  }),
).toString('base64url');

const searchHarness = (
  t,
  response = { records: [], hasNextPage: false, nextCursor: null },
) => {
  const originalKey = process.env.FANHAN_API_KEY;
  process.env.FANHAN_API_KEY = 'search-test-key';
  t.after(() => {
    if (originalKey === undefined) delete process.env.FANHAN_API_KEY;
    else process.env.FANHAN_API_KEY = originalKey;
  });
  const requests = [];
  const output = [];
  t.mock.method(console, 'log', (value) => output.push(value));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json(response);
  });
  return { requests, output };
};

test('search resources encode scalar values, preserve auth, and emit the exact JSON envelope', async (t) => {
  const { main } = await import('./cli.mjs');
  const page = {
    records: [{ id: 'visible', name: 'Acme' }],
    hasNextPage: true,
    nextCursor: searchCursor,
  };
  const { requests, output } = searchHarness(t, page);
  const companyId = '00000000-0000-4000-8000-000000000002';
  for (const resource of ['candidates', 'companies', 'jobs']) {
    await main([
      'search',
      resource,
      '  中文 &%_\\?=/ ',
      '--base',
      'https://example.test',
      '--limit',
      '99',
      '--cursor',
      searchCursor,
      '--json',
      ...(resource === 'jobs' ? ['--company-id', companyId] : []),
    ]);
    const { url, options } = requests.at(-1);
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://example.test');
    assert.equal(parsed.pathname, `/recruiting/search/${resource}`);
    assert.equal(parsed.searchParams.get('q'), '中文 &%_\\?=/');
    assert.equal(parsed.searchParams.get('limit'), '50');
    assert.equal(parsed.searchParams.get('cursor'), searchCursor);
    assert.equal(
      parsed.searchParams.get('companyId'),
      resource === 'jobs' ? companyId : null,
    );
    assert.equal(options.headers.authorization, 'Bearer search-test-key');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(output.at(-1), JSON.stringify(page));
  }
});

test('search validates positional syntax and bounded values before any network request', async (t) => {
  const { main } = await import('./cli.mjs');
  const { requests } = searchHarness(t);
  for (const arguments_ of [
    ['search'],
    ['search', 'records', 'x'],
    ['search', '../companies', 'x'],
    ['search', 'jobs'],
    ['search', 'jobs', ' '],
    ['search', 'jobs', 'x'.repeat(101)],
    ['search', 'jobs', 'x', 'extra'],
    ...['0', '-1', '2.5', '2junk', '9007199254740992'].map((value) => [
      'search',
      'jobs',
      'x',
      '--limit',
      value,
    ]),
    ...[
      '',
      'bad',
      Buffer.from(JSON.stringify({ id: 'bad' })).toString('base64url'),
      Buffer.from(
        JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          sort: 'name',
        }),
      ).toString('base64url'),
    ].map((value) => ['search', 'jobs', 'x', '--cursor', value]),
    ['search', 'jobs', 'x', '--company-id', 'bad'],
    [
      'search',
      'candidates',
      'x',
      '--company-id',
      '00000000-0000-4000-8000-000000000002',
    ],
  ])
    await assert.rejects(main(arguments_));
  assert.equal(requests.length, 0);
});

test('search tables show only public fields, neutralize terminal controls and advertise the next page', async (t) => {
  const { main } = await import('./cli.mjs');
  const page = {
    records: [
      {
        id: 'candidate-1',
        name: { firstName: 'Ada\x1b[31m', lastName: 'Lovelace\nInjected' },
        jobTitle: 'Engineer\tJS',
        emails: 'hidden-email',
        phones: 'hidden-phone',
        files: 'hidden-file',
        jobDescription: 'hidden-resume',
      },
    ],
    hasNextPage: true,
    nextCursor: searchCursor,
  };
  const { output } = searchHarness(t, page);
  await main(['search', 'candidates', 'Ada', '--base', 'https://example.test']);
  assert.match(output[0], /ID\s+Name\s+Headline/);
  assert.match(output[0], /candidate-1/);
  assert.match(output[0], /Ada/);
  assert.match(output[0], new RegExp(`Next page: --cursor ${searchCursor}`));
  assert.doesNotMatch(output[0], /hidden-|\x1b|\t/);
  assert.equal(output[0].split('\n').length, 3);
});

test('search handles company/job tables, missing readable labels, empty pages and server defaults', async (t) => {
  const { main } = await import('./cli.mjs');
  const { output, requests } = searchHarness(t);
  const pages = [
    {
      records: [
        {
          id: 'company-1',
          name: 'Acme',
          domainName: { primaryLinkUrl: 'https://acme.test' },
        },
      ],
      hasNextPage: false,
      nextCursor: null,
    },
    {
      records: [
        {
          id: 'job-1',
          name: 'Engineer',
          companyId: 'company-1',
          jobStatus: 'CLOSED',
        },
      ],
      hasNextPage: false,
      nextCursor: null,
    },
    { records: [{ id: 'company-2' }], hasNextPage: false, nextCursor: null },
    { records: [], hasNextPage: false, nextCursor: null },
  ];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json(pages.shift());
  };
  for (const resource of ['companies', 'jobs', 'companies', 'candidates'])
    await main(['search', resource, 'x', '--base', 'https://example.test']);
  assert.match(output[0], /Domain/);
  assert.match(output[0], /https:\/\/acme.test/);
  assert.match(output[1], /Company ID\s+Status/);
  assert.match(output[1], /CLOSED/);
  assert.match(output[2], /company-2/);
  assert.doesNotMatch(output[2], /undefined|null|Next page/);
  assert.equal(output[3], 'No matches.');
  assert.deepEqual([...new URL(requests[0].url).searchParams.keys()], ['q']);
});

test('search preserves permission/redirect errors without output or credential disclosure', async (t) => {
  const { main } = await import('./cli.mjs');
  const { output } = searchHarness(t);
  for (const status of [401, 403, 302]) {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.redirect, 'error');
      return Response.json({ message: 'denied search-test-key' }, { status });
    };
    await assert.rejects(
      main(['search', 'jobs', 'x', '--base', 'https://example.test', '--json']),
      (error) => {
        assert.equal(error.status, status);
        assert.doesNotMatch(error.message, /search-test-key/);
        return true;
      },
    );
  }
  assert.deepEqual(output, []);
});

test('fanhan public entrypoint advertises search help without authentication or network access', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    [
      new URL('./fanhan.mjs', import.meta.url).pathname,
      'search',
      '--help',
      '--json',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const help = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(help.commands.search), [
    'candidates',
    'companies',
    'jobs',
  ]);
  assert.match(help.commands.search.jobs, /--company-id/);
  assert.match(
    help.commands.search.candidates,
    /<q>.*--limit.*--cursor.*--json/,
  );
});

test('workflow CLI uses paginated result APIs and explicit reparse receipts', async () => {
  const { main } = await import('./cli.mjs');
  const previous = {
    fetch: globalThis.fetch,
    key: process.env.FANHAN_API_KEY,
    log: console.log,
  };
  const calls = [];
  process.env.FANHAN_API_KEY = 'test-key';
  console.log = () => {};
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      body: options.body ? JSON.parse(options.body) : undefined,
    });
    return Response.json({
      intakeId: 'task',
      records: [],
      count: 0,
      hasNextPage: false,
    });
  };
  const base = ['--base', 'http://127.0.0.1:23001'];
  try {
    await main([
      'match',
      'results',
      ...base,
      '--query',
      'A & B',
      '--limit',
      '20',
      '--offset',
      '40',
      '--read',
      'unread',
    ]);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/recruiting/match-results');
    assert.equal(url.searchParams.get('search'), 'A & B');
    assert.equal(url.searchParams.get('limit'), '20');
    await main([
      'candidates',
      'reparse',
      ...base,
      '--id',
      'candidate',
      '--batch-id',
      'batch',
    ]);
    assert.equal(
      calls[1].url,
      'http://127.0.0.1:23001/recruiting/candidates/candidate/reparse',
    );
    assert.deepEqual(calls[1].body, { batchKey: 'batch' });
    await main([
      'match',
      'workflow',
      ...base,
      '--id',
      'run',
      '--status',
      'TO_CONTACT',
    ]);
    assert.deepEqual(calls[2].body, { status: 'TO_CONTACT' });
    await main(['share', 'list', ...base, '--query', 'portfolio']);
    assert.equal(new URL(calls[3].url).pathname, '/recruiting/share-results');
    await assert.rejects(
      main(['match', 'results', ...base, '--limit', '0']),
      /limit/,
    );
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = previous.fetch;
    console.log = previous.log;
    if (previous.key === undefined) delete process.env.FANHAN_API_KEY;
    else process.env.FANHAN_API_KEY = previous.key;
  }
});
