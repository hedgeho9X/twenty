/** Verifies recovery without duplicating non-idempotent operations. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRecruitingRetry } from './retry-client.mjs';
test('recovers a deployment proxy 404 for GET and stable reparse POST', async () => {
  let calls = 0;
  const run = async () => { if (++calls === 1) throw Object.assign(new Error('proxy'), { status: 404, code: 'INVALID_JSON' }); return 'ok'; };
  const client = withRecruitingRetry({ request: run, post: run }, { pause: async () => {} });
  assert.equal(await client.request('/read'), 'ok');
  calls = 0;
  assert.equal(await client.post('candidates/id/reparse', { batchKey: 'same' }), 'ok');
  assert.equal(calls, 2);
});
test('does not repeat unsafe POSTs or real missing-record errors', async () => {
  let calls = 0;
  const fail = async () => { calls++; throw Object.assign(new Error('proxy'), { status: 503 }); };
  const client = withRecruitingRetry({ request: fail, post: fail }, { pause: async () => {} });
  await assert.rejects(client.post('share-links', {}));
  assert.equal(calls, 1);
  const notFound = withRecruitingRetry({ request: async () => { throw Object.assign(new Error('gone'), { status: 404 }); } });
  await assert.rejects(notFound.request('/missing'), /gone/);
});
