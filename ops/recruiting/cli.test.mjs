/** Checks credential handling and asynchronous receipts without consuming models or mutating a workspace. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecruitingClient, waitForRecruitingTask } from './cli.mjs';

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
