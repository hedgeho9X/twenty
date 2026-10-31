/** Registers Jev through the native administrator API; credential values stay in memory and local configuration. */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { localGraphql } from './local-api.mjs';

const credentialPath = join(
  homedir(),
  '.config/candidate-ranking-algorithm/.env',
);
let apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) {
  const info = await stat(credentialPath);
  if (info.mode & 0o077 || info.uid !== process.getuid())
    throw new Error(
      'Jev credential must be owned by the current user and private',
    );
  const match = (await readFile(credentialPath, 'utf8')).match(
    /^AI_GATEWAY_API_KEY=(vck_[A-Za-z0-9_-]+)\s*$/m,
  );
  if (!match) throw new Error('Jev credential is unavailable');
  apiKey = match[1];
}
const providerConfig = {
  npm: '@ai-sdk/gateway',
  label: 'Vercel AI Gateway',
  apiKey,
  models: [
    {
      name: 'typesafe-ai/jev',
      label: 'Jev',
      kind: 'evaluation',
      supportedQuestionTypes: ['boolean', 'choice', 'score'],
      maxScoreLevels: 10,
      inputCostPerMillionTokens: 0.042,
      outputCostPerMillionTokens: 0,
    },
  ],
};
await localGraphql(
  'mutation Configure($providerName:String!,$providerConfig:JSON!){addAiProvider(providerName:$providerName,providerConfig:$providerConfig)}',
  {
    providerName: 'recruiting-gateway',
    providerConfig,
  },
  '/admin-panel',
);
console.log(
  JSON.stringify({
    configured: true,
    modelId: 'recruiting-gateway/typesafe-ai/jev',
  }),
);
