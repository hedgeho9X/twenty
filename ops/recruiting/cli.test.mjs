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
