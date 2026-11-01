/** Reads the explicitly selected local Codex login without copying or refreshing its tokens. */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import type { SubscriptionCredential } from './subscription-fetch';

const credentialSchema = z.object({
  auth_mode: z.literal('chatgpt'),
  tokens: z.object({
    access_token: z.string().min(32),
    account_id: z.string().min(1),
  }),
});

/** Enforces owner-only storage and account binding before returning a request credential. */
export const loadLocalCodexCredential = async (
  expectedAccountId?: string,
): Promise<SubscriptionCredential> => {
  const file =
    process.env.RECRUITING_CODEX_AUTH_FILE ??
    join(homedir(), '.codex/auth.json');
  try {
    const info = await stat(file);
    if (
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())
    ) {
      throw new Error('insecure_auth_file');
    }
    const result = credentialSchema.safeParse(
      JSON.parse(await readFile(file, 'utf8')),
    );
    if (!result.success) throw new Error('invalid_auth_file');
    const { access_token: accessToken, account_id: accountId } =
      result.data.tokens;
    if (expectedAccountId && accountId !== expectedAccountId)
      throw new Error('account_changed');
    let clientVersion = '0.144.1';
    try {
      const metadata = z
        .object({ client_version: z.string().regex(/^\d+\.\d+\.\d+$/) })
        .parse(
          JSON.parse(
            await readFile(join(dirname(file), 'models_cache.json'), 'utf8'),
          ),
        );
      clientVersion = metadata.client_version;
    } catch {
      // CLI-only installations may not have a desktop model cache.
    }
    return { accessToken, accountId, protocol: 'codex', clientVersion };
  } catch {
    throw new Error(
      'ChatGPT subscription is unavailable; reconnect the selected account',
    );
  }
};
