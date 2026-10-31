/** Reads the explicitly selected local Codex login without copying or refreshing its tokens. */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
    return { accessToken, accountId, protocol: 'codex' };
  } catch {
    throw new Error(
      'ChatGPT subscription is unavailable; reconnect the selected account',
    );
  }
};
