/** Keeps credentials in macOS Keychain, binding each entry to one validated API origin. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const service = 'fanhan-cli';
const configPath = () =>
  join(
    process.env.FANHAN_CONFIG_DIR ?? join(homedir(), '.config', 'fanhan'),
    'config.json',
  );
/** Canonical origins also form the Keychain isolation boundary. */
export const apiOrigin = (value) => {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol === 'http:' &&
      process.env.FANHAN_ALLOW_HTTP !== '1' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Use HTTPS or an explicit local API origin');
  return url.origin;
};
const account = (base) =>
  createHash('sha256').update(apiOrigin(base)).digest('hex');
/** Never forwards Keychain output or a secret in process arguments. */
const security = (args, input) =>
  new Promise((resolve, reject) => {
    if (process.platform !== 'darwin')
      return reject(
        new Error(
          'Persistent login requires macOS Keychain; use FANHAN_API_KEY on this platform',
        ),
      );
    const child = spawn('/usr/bin/security', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.resume();
    child.on('error', () => reject(new Error('Keychain is unavailable')));
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
export const keychain = {
  async get(base) {
    const result = await security([
      'find-generic-password',
      '-s',
      service,
      '-a',
      account(base),
      '-w',
    ]);
    if (result.code === 44) return undefined;
    if (result.code !== 0)
      throw new Error('Cannot read Keychain; unlock it and retry');
    return result.stdout.trim();
  },
  async set(base, token) {
    if (!/^[A-Za-z0-9_.-]{1,16384}$/.test(token))
      throw new Error('Invalid API key');
    await security(
      ['-i'],
      `add-generic-password -U -s ${service} -a ${account(base)} -w ${token}\nquit\n`,
    );
    if ((await this.get(base)) !== token)
      throw new Error('Keychain did not save the credential');
  },
  async delete(base) {
    const result = await security([
      'delete-generic-password',
      '-s',
      service,
      '-a',
      account(base),
    ]);
    if (result.code !== 0 && result.code !== 44)
      throw new Error('Cannot delete Keychain credential');
  },
};
/** Only non-secret connection metadata is written to disk. */
export const readConfig = async () => {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('Cannot read fanhan config');
  }
};
export const saveConfig = async (base) => {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify({ baseUrl: apiOrigin(base) }), {
    mode: 0o600,
  });
  await rename(temp, path);
};
/** Explicit environment credentials take precedence over the origin-bound saved login. */
export const resolveAuth = async (
  base,
  env = process.env,
  store = keychain,
  config,
) => {
  config ??= await readConfig();
  const baseUrl = apiOrigin(
    base ??
      env.FANHAN_BASE_URL ??
      env.TWENTY_BASE_URL ??
      config.baseUrl ??
      'http://localhost:23001',
  );
  const explicit = env.FANHAN_API_KEY ?? env.TWENTY_API_KEY;
  const token =
    explicit ??
    (process.platform === 'darwin' ? await store.get(baseUrl) : undefined);
  return {
    baseUrl,
    token,
    source:
      explicit !== undefined ? 'environment' : token ? 'keychain' : 'none',
  };
};
/** Reads a piped key or a hidden terminal prompt without echoing it. */
export const readKey = async (stdin = process.stdin) => {
  if (!stdin.isTTY) {
    let value = '';
    for await (const chunk of stdin) {
      value += chunk;
      if (value.length > 16384) throw new Error('API key is too long');
    }
    return value.trim();
  }
  process.stderr.write('API Key: ');
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stderr.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') return finish(new Error('Login cancelled'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
        if (value.length > 16384)
          return finish(new Error('API key is too long'));
      }
    };
    stdin.on('data', onData);
  });
};
