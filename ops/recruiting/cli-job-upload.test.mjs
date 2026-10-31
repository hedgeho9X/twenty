/** Verifies crash/response-loss recovery and identity boundaries without any real API, credentials or model requests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { submitJobMaterials } from './cli-job-upload.mjs';

/** Creates private synthetic files and a server-like recorder with stable business idempotency. */
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'recruiting-cli-'));
  const first = join(root, 'one.txt'),
    second = join(root, 'two.txt');
  await writeFile(first, 'synthetic JD one');
  await writeFile(second, 'synthetic JD two');
  const calls = [];
  const labels = new Map();
  let uploads = 0,
    puts = 0,
    failure;
  const intakeId = '7b70c125-1738-5ea9-8cf8-88f5b1cf9670';
  const client = {
    post: async (path, body) => {
      calls.push({ path, body });
      if (path === 'uploads/targets') {
        uploads++;
        labels.set(String(uploads), body.filename);
        return {
          uploadUrl: 'http://127.0.0.1/upload',
          contentType: 'text/plain',
          uploadReceipt: String(uploads),
        };
      }
      if (path === 'uploads/complete')
        return {
          fileId: 'file-' + body.uploadReceipt,
          label: labels.get(body.uploadReceipt),
          role: 'primary',
          uploadReceipt: 'synthetic-proof',
        };
      if (failure) {
        const error = failure;
        failure = undefined;
        throw error;
      }
      return {
        intakeId,
        state: 'NEEDS_REVIEW',
        stage: 'AWAITING_CONFIRMATION',
      };
    },
    request: async (path) => {
      calls.push({ path });
      return {
        intakeId,
        state: 'NEEDS_REVIEW',
        stage: 'AWAITING_CONFIRMATION',
      };
    },
  };
  const options = {
    client,
    filenames: [first, second],
    request: {
      companyId: 'company',
      source: 'api',
      idempotencyKey: 'stable-key',
      note: 'instructions',
    },
    baseUrl: 'http://127.0.0.1:23001',
    token: 'synthetic-key',
    stateDirectory: join(root, 'cache'),
    fetcher: async () => {
      puts++;
      return { ok: true };
    },
  };
  return {
    root,
    first,
    options,
    calls,
    uploads: () => uploads,
    puts: () => puts,
    fail: () => {
      failure = new Error('response lost');
    },
  };
};

test('response loss retains completed file references and a later invocation reuses the same input', async () => {
  const f = await setup();
  try {
    f.fail();
    await assert.rejects(submitJobMaterials(f.options), /response lost/);
    const result = await submitJobMaterials(f.options);
    assert.ok(result.intakeId);
    assert.equal(f.uploads(), 2);
    assert.equal(f.puts(), 2);
    const submissions = f.calls.filter((c) => c.path === 'job-intakes');
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[0].body, submissions[1].body);
    await submitJobMaterials(f.options);
    assert.equal(
      f.calls.at(-1).path,
      '/recruiting/resume-intakes/' + result.intakeId,
    );
    assert.equal((await stat(f.options.stateDirectory)).mode & 0o077, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('changed bytes or instructions cannot silently reuse a submission key', async () => {
  const f = await setup();
  try {
    await submitJobMaterials(f.options);
    await assert.rejects(
      submitJobMaterials({
        ...f.options,
        request: { ...f.options.request, note: 'changed' },
      }),
      /different materials/,
    );
    await writeFile(f.first, 'changed original');
    await assert.rejects(submitJobMaterials(f.options), /different materials/);
    assert.equal(f.uploads(), 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('credentials and server origins never share cached file capabilities', async () => {
  const f = await setup();
  try {
    await submitJobMaterials(f.options);
    await submitJobMaterials({ ...f.options, token: 'other-key' });
    await submitJobMaterials({
      ...f.options,
      baseUrl: 'http://localhost:23001',
    });
    assert.equal(f.uploads(), 6);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('concurrent callers publish one winning reference per file before submitting', async () => {
  const f = await setup();
  try {
    await Promise.all([
      submitJobMaterials(f.options),
      submitJobMaterials(f.options),
    ]);
    const submissions = f.calls.filter((c) => c.path === 'job-intakes');
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[0].body.files, submissions[1].body.files);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a later file failure keeps earlier completed uploads across invocations', async () => {
  const f = await setup();
  try {
    let calls = 0;
    const options = {
      ...f.options,
      fetcher: async () => {
        if (++calls === 2) throw new Error('network unavailable');
        return { ok: true };
      },
    };
    await assert.rejects(submitJobMaterials(options), /network unavailable/);
    await submitJobMaterials(options);
    assert.equal(f.uploads(), 3);
    assert.equal(
      f.calls.filter(
        (c) => c.path === 'uploads/complete' && c.body.uploadReceipt === '1',
      ).length,
      1,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
