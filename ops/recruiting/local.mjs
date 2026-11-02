/** Runs the source checkout against a dedicated OrbStack database and cache. */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureLocalMailConfig } from './local-mail-config.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateDirectory = join(repository, '.local/recruiting');
const environmentPath = join(privateDirectory, 'environment.json');
const serverDirectory = join(repository, 'packages/twenty-server');
const composeArguments = [
  'compose',
  '-f',
  join(repository, 'ops/recruiting/compose.yaml'),
];

/** Starts a foreground child without exposing environment credentials as arguments. */
const run = (
  binary,
  arguments_,
  environment = process.env,
  cwd = repository,
) => {
  const child = spawnSync(binary, arguments_, {
    cwd,
    env: environment,
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0)
    throw new Error(
      `Command failed: ${binary} (${child.status ?? child.signal})`,
    );
};

/** Creates private configuration once; subsequent invocations retain all secrets. */
const initialize = async () => {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  await mkdir(join(privateDirectory, 'logs'), { recursive: true, mode: 0o700 });
  await ensureLocalMailConfig(privateDirectory);
  let environment;
  try {
    environment = JSON.parse(await readFile(environmentPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const password = randomBytes(24).toString('hex');
    environment = {
      NODE_ENV: 'development',
      NODE_PORT: '23001',
      PORT: '23001',
      PG_DATABASE_URL: `postgres://twenty:${password}@127.0.0.1:25432/recruiting`,
      REDIS_URL: 'redis://127.0.0.1:26379',
      REDIS_CACHE_PREFIX: 'recruiting-local',
      APP_SECRET: randomBytes(32).toString('hex'),
      SERVER_URL: 'http://localhost:23000',
      FRONTEND_URL: 'http://localhost:23000',
      REACT_APP_PORT: '23000',
      REACT_APP_SERVER_BASE_URL: 'http://localhost:23001',
      VITE_HOST: '127.0.0.1',
      STORAGE_TYPE: 'local',
      STORAGE_LOCAL_PATH: join(privateDirectory, 'storage'),
      LOGIC_FUNCTION_TYPE: 'LOCAL',
      CODE_INTERPRETER_TYPE: 'LOCAL',
      EMAIL_DRIVER: 'LOGGER',
      IS_IMAP_SMTP_CALDAV_ENABLED: 'false',
      IS_CONFIG_VARIABLES_IN_DB_ENABLED: 'false',
      IS_BILLING_ENABLED: 'false',
      ANALYTICS_ENABLED: 'false',
      SIGN_IN_PREFILLED: 'false',
      DISABLE_CRON_JOBS_REGISTRATION: 'true',
      DISABLE_WORKSPACE_CRON_JOBS_REGISTRATION: 'true',
      IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS: 'false',
    };
    await writeFile(environmentPath, JSON.stringify(environment, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
  }
  const database = new URL(environment.PG_DATABASE_URL);
  if (
    database.hostname !== '127.0.0.1' ||
    database.port !== '25432' ||
    database.pathname !== '/recruiting'
  ) {
    throw new Error(
      'Refusing a database outside the dedicated local recruiting environment',
    );
  }
  await writeFile(
    join(privateDirectory, 'postgres.env'),
    `POSTGRES_USER=twenty\nPOSTGRES_DB=recruiting\nPOSTGRES_PASSWORD=${database.password}\n`,
    { mode: 0o600 },
  );
  const parserDefaults = {
    RECRUITING_STATE_SIGNING_KEY: randomBytes(32).toString('hex'),
    RECRUITING_PARSER_TOKEN: randomBytes(32).toString('hex'),
    RECRUITING_PARSER_URL: 'http://127.0.0.1:23003',
    RECRUITING_UID: String(process.getuid()),
    RECRUITING_GID: String(process.getgid()),
  };
  let changed = false;
  for (const [key, value] of Object.entries(parserDefaults)) {
    if (environment[key] === undefined) {
      environment[key] = value;
      changed = true;
    }
  }
  if (changed)
    await writeFile(environmentPath, JSON.stringify(environment, null, 2), {
      mode: 0o600,
    });
  await mkdir(join(privateDirectory, 'parser-output'), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    join(privateDirectory, 'parser.env'),
    `RECRUITING_PARSER_TOKEN=${environment.RECRUITING_PARSER_TOKEN}\nHF_HUB_OFFLINE=1\nTRANSFORMERS_OFFLINE=1\n`,
    { mode: 0o600 },
  );
  return {
    ...process.env,
    ...environment,
    PATH: [
      join(repository, 'ops/recruiting/bin'),
      dirname(process.execPath),
      process.env.PATH,
    ].join(delimiter),
  };
};

/** Refuses Docker mutations when another context is selected. */
const assertOrbStack = () => {
  const result = spawnSync('docker', ['context', 'show'], { encoding: 'utf8' });
  if (result.status !== 0 || result.stdout.trim() !== 'orbstack') {
    throw new Error(
      'Select the local orbstack Docker context before continuing',
    );
  }
};

const [action = 'help', ...arguments_] = process.argv.slice(2);
if (
  [
    'init',
    'up',
    'down',
    'parser-up',
    'build',
    'api',
    'worker',
    'ai-worker',
    'front',
    'command',
    'database-init',
  ].includes(action)
) {
  const environment = await initialize();
  if (action === 'init')
    console.log('Private recruiting configuration is ready');
  if (action === 'up' || action === 'down') {
    assertOrbStack();
    run('docker', [
      ...composeArguments,
      action,
      ...(action === 'up' ? ['-d', '--wait'] : []),
    ]);
  }
  if (action === 'parser-up') {
    assertOrbStack();
    run(
      'docker',
      [
        ...composeArguments,
        '--profile',
        'parser',
        'up',
        '-d',
        '--wait',
        'parser',
      ],
      environment,
    );
  }
  if (action === 'build')
    run(process.execPath, ['ops/recruiting/build-source.mjs'], environment);
  if (action === 'api')
    run(process.execPath, ['dist/main.js'], environment, serverDirectory);
  if (action === 'worker')
    run(
      process.execPath,
      ['dist/queue-worker/queue-worker.js'],
      environment,
      serverDirectory,
    );
  if (action === 'ai-worker')
    run(
      process.execPath,
      ['dist/queue-worker/queue-worker.js'],
      {
        ...environment,
        WORKER_ENABLED_QUEUES: 'ai-queue,ai-stream-queue',
        DISABLE_CRON_JOBS_REGISTRATION: 'true',
        DISABLE_WORKSPACE_CRON_JOBS_REGISTRATION: 'true',
      },
      serverDirectory,
    );
  if (action === 'front')
    run(
      process.execPath,
      [
        'node_modules/.bin/vite',
        '--config',
        'packages/twenty-front/vite.config.ts',
        '--strictPort',
      ],
      environment,
    );
  if (action === 'command')
    run(
      process.execPath,
      ['dist/command/command.js', ...arguments_],
      environment,
      serverDirectory,
    );
  if (action === 'database-init') {
    run(
      process.execPath,
      ['dist/database/scripts/setup-db.js'],
      environment,
      serverDirectory,
    );
    run(
      process.execPath,
      [
        'dist/command/command.js',
        'run-instance-commands',
        '--force',
        '--include-slow',
      ],
      environment,
      serverDirectory,
    );
  }
} else {
  console.log(
    'Usage: node ops/recruiting/local.mjs init|up|down|build|database-init|api|front|worker|ai-worker|command',
  );
  if (action !== 'help') process.exitCode = 1;
}
