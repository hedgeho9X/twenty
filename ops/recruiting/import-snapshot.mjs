/** Copies the authorized local snapshot into an empty, isolated recruiting database. */
import { closeSync, openSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateDirectory = join(repository, '.local/recruiting');
const sourceContainer = 'fanhan-local-db-1';
const destinationContainer = 'twenty-recruiting-db-1';
const sourceDirectory = process.argv[2];
if (!sourceDirectory) throw new Error('Pass the existing private local-environment directory');

/** Executes Docker commands with input/output separated from logged diagnostics. */
const docker = (arguments_, options = {}) => {
  const result = spawnSync('docker', arguments_, {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options,
  });
  if (result.status !== 0) throw new Error(`Docker operation failed: ${result.stderr?.slice(0, 400) ?? result.error?.code ?? result.status}`);
  return result.stdout?.trim();
};

/** Reads the source in an enforced read-only session; writes only to the named destination. */
const sql = (container, statement) => {
  if (![sourceContainer, destinationContainer].includes(container)) throw new Error('Unexpected container');
  const command = container === sourceContainer
    ? ['sh', '-c', 'exec env PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 -At']
    : ['psql', '-U', 'twenty', '-d', 'recruiting', '-X', '-v', 'ON_ERROR_STOP=1', '-At'];
  return docker(['exec', '-i', container, ...command], { input: statement });
};

/** Captures counts only, keeping names, resumes and credentials out of the report. */
const businessCounts = (container) => JSON.parse(sql(container, `
  SELECT json_build_object(
    'companies',(SELECT count(*) FROM workspace_4jgxpoe06z2lp3cp2mjiatyec.company WHERE "deletedAt" IS NULL),
    'jobs',(SELECT count(*) FROM workspace_4jgxpoe06z2lp3cp2mjiatyec."_recruitmentJob" WHERE "deletedAt" IS NULL),
    'people',(SELECT count(*) FROM workspace_4jgxpoe06z2lp3cp2mjiatyec.person WHERE "deletedAt" IS NULL),
    'candidates',(SELECT count(*) FROM workspace_4jgxpoe06z2lp3cp2mjiatyec.person WHERE "deletedAt" IS NULL AND 'CANDIDATE'=ANY("contactRoles"))
  );
`));

const context = docker(['context', 'show']);
if (context !== 'orbstack') throw new Error('The local OrbStack context is required');
const project = docker(['inspect', destinationContainer, '--format', '{{index .Config.Labels "com.docker.compose.project"}}']);
if (project !== 'twenty-recruiting') throw new Error('Destination project mismatch');
const tableCount = Number(sql(destinationContainer, `SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');`));
if (tableCount !== 0) throw new Error('Destination must be empty; existing databases are never overwritten');

await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
const before = businessCounts(sourceContainer);
const dumpPath = join(privateDirectory, 'source.dump');
const dump = openSync(dumpPath, 'wx', 0o600);
try {
  docker(['exec', sourceContainer, 'sh', '-c',
    'exec env PGOPTIONS="-c default_transaction_read_only=on" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl'],
  { stdio: ['ignore', dump, 'pipe'] });
} finally {
  closeSync(dump);
}
const input = openSync(dumpPath, 'r');
try {
  docker(['exec', '-i', destinationContainer, 'pg_restore', '-U', 'twenty', '-d', 'recruiting',
    '--no-owner', '--no-acl', '--single-transaction', '--exit-on-error'],
  { stdio: [input, 'pipe', 'pipe'] });
} finally {
  closeSync(input);
}

// Disable copied automation before a new server or worker can observe the data.
sql(destinationContainer, `
BEGIN;
UPDATE core."workflowVersion" SET status='DEACTIVATED' WHERE status='ACTIVE';
UPDATE core.workflow SET "lastPublishedVersionId"=NULL, "lastPublishedCoreWorkflowVersionId"=NULL;
UPDATE core."messageChannel" SET "isSyncEnabled"=false;
UPDATE core."calendarChannel" SET "isSyncEnabled"=false;
UPDATE core.workspace SET "customDomain"=NULL, "isCustomDomainEnabled"=false;
DELETE FROM core."keyValuePair" WHERE type='CONFIG_VARIABLE' AND key NOT IN ('AI_PROVIDERS');
DO $local$
DECLARE entry record; field record;
BEGIN
  FOR entry IN SELECT "databaseSchema" AS schema_name FROM core.workspace LOOP
    IF entry.schema_name !~ '^workspace_[a-z0-9]+$' THEN RAISE EXCEPTION 'Unexpected workspace schema'; END IF;
    EXECUTE format('UPDATE %I.workflow SET "lastPublishedVersionId"=NULL, statuses=array_replace(statuses,''ACTIVE'',''DEACTIVATED'')',entry.schema_name);
    EXECUTE format('UPDATE %I."workflowVersion" SET status=''DEACTIVATED'' WHERE status=''ACTIVE''',entry.schema_name);
  END LOOP;
  FOR field IN SELECT column_name FROM information_schema.columns WHERE table_schema='core' AND table_name='logicFunction' AND column_name LIKE '%TriggerSettings' LOOP
    EXECUTE format('UPDATE core."logicFunction" SET %I=NULL',field.column_name);
  END LOOP;
  IF to_regclass('core.webhook') IS NOT NULL THEN DELETE FROM core.webhook; END IF;
END $local$;
COMMIT;
`);

const sourceEnvironment = parseEnv(await readFile(join(resolve(sourceDirectory), 'local/.env'), 'utf8'));
const environmentPath = join(privateDirectory, 'environment.json');
const environment = JSON.parse(await readFile(environmentPath, 'utf8'));
for (const key of ['APP_SECRET', 'ENCRYPTION_KEY', 'FALLBACK_ENCRYPTION_KEY']) {
  if (sourceEnvironment[key]) environment[key] = sourceEnvironment[key];
}
environment.IS_CONFIG_VARIABLES_IN_DB_ENABLED = 'true';
await writeFile(environmentPath, JSON.stringify(environment, null, 2), { mode: 0o600 });
await cp(join(resolve(sourceDirectory), 'objects'), environment.STORAGE_LOCAL_PATH, {
  recursive: true, errorOnExist: true, force: false, preserveTimestamps: true,
});
const after = businessCounts(destinationContainer);
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Business counts changed during restore');
const automation = JSON.parse(sql(destinationContainer, `SELECT json_build_object(
  'activeWorkflows',(SELECT count(*) FROM core."workflowVersion" WHERE status='ACTIVE'),
  'mailSyncEnabled',(SELECT count(*) FROM core."messageChannel" WHERE "isSyncEnabled"),
  'calendarSyncEnabled',(SELECT count(*) FROM core."calendarChannel" WHERE "isSyncEnabled")
);`));
const report = { createdAt: new Date().toISOString(), sourceContainer, destinationContainer, before, after, automation };
await writeFile(join(privateDirectory, 'import-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report));
