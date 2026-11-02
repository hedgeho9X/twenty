/** Exercises deployment boundaries and additive metadata planning without a live mutation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetadataClient, planMetadata } from './target-metadata.mjs';
const existing = [
  {
    id: 'object',
    nameSingular: 'person',
    fields: [
      {
        id: 'field',
        name: 'files',
        type: 'FILES',
        settings: { maxNumberOfValues: 60, untouched: true },
      },
    ],
  },
];
test('does not shrink existing native file capacity', () => {
  assert.deepEqual(
    planMetadata(
      existing,
      [],
      [
        [
          'person',
          { name: 'files', type: 'FILES', settings: { maxNumberOfValues: 30 } },
        ],
      ],
    ),
    [],
  );
});
test('preserves unrelated file settings when expanding capacity', () => {
  const plan = planMetadata(
    existing,
    [],
    [
      [
        'person',
        { name: 'files', type: 'FILES', settings: { maxNumberOfValues: 90 } },
      ],
    ],
  );
  assert.deepEqual(plan[0].update.settings, {
    maxNumberOfValues: 90,
    untouched: true,
  });
});
test('type conflicts abort planning before any mutation', () => {
  assert.throws(
    () =>
      planMetadata(existing, [], [['person', { name: 'files', type: 'TEXT' }]]),
    /Conflicting field type/,
  );
});
test('enum additions preserve historical options and IDs', () => {
  const old = [{ value: 'old', id: 'keep' }];
  const plan = planMetadata(
    [
      {
        id: 'o',
        nameSingular: 'intake',
        fields: [{ name: 'state', type: 'SELECT', options: old }],
      },
    ],
    [],
    [
      [
        'intake',
        {
          name: 'state',
          type: 'SELECT',
          options: [{ value: 'new', id: 'new-id' }],
        },
      ],
    ],
  );
  assert.deepEqual(plan[0].update.options[0], old[0]);
});
test('plaintext remote endpoints and URL-embedded credentials are refused', () => {
  for (const target of [
    'http://example.com',
    'https://secret@example.com',
    'https://example.com/path',
  ])
    assert.throws(() =>
      createMetadataClient({
        target,
        workspaceId: 'workspace',
        token: 'secret',
      }),
    );
});
test('workspace mismatch never requests object metadata', async () => {
  let calls = 0;
  const client = createMetadataClient({
    target: 'https://example.com',
    workspaceId: 'wanted',
    token: 'secret',
    fetchImpl: async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({ data: { currentWorkspace: { id: 'other' } } }),
      };
    },
  });
  await assert.rejects(client.inspect(), /Workspace identity mismatch/);
  assert.equal(calls, 1);
});
test('ambiguous write failures are not retried', async () => {
  let calls = 0;
  const client = createMetadataClient({
    target: 'https://example.com',
    workspaceId: 'wanted',
    token: 'secret',
    fetchImpl: async () => {
      calls++;
      throw Error('network connection lost');
    },
  });
  await assert.rejects(
    client.graphql('mutation Create'),
    /network connection lost/,
  );
  assert.equal(calls, 1);
});
