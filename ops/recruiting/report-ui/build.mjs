/** Bundles actual Shadcn primitives into an offline HTML report, selecting anonymous facts from private frozen artifacts. */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const directory = join(repository, '.local/recruiting/evaluations/rsi-v1');
/** Reads local evidence without invoking any API or spending model quota. */
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const manifestBytes = await readFile(join(directory, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const report = await json(join(directory, 'report.json'));
if (
  createHash('sha256').update(manifestBytes).digest('hex') !==
  report.manifestHash
)
  throw new Error('Report and frozen manifest disagree');
const jobs = await json(join(directory, 'jobs.json'));
const usage = await json(join(directory, 'native-subscription-usage.json'));
const rows = [];
for (const [index, candidate] of manifest.candidates.entries()) {
  const run = await json(join(directory, candidate.id, 'match.json'));
  const silver = await json(join(directory, candidate.id, 'silver.json'));
  for (const label of silver.labels) {
    const pair = run.results.find((value) => value.jobId === label.jobId);
    if (!pair || !Number.isFinite(pair.score))
      throw new Error('Missing evaluated pair');
    rows.push({
      pairId: `${candidate.id}:${label.jobId}`,
      candidate: `C${String(index + 1).padStart(2, '0')}`,
      split: candidate.split,
      job: jobs[label.jobId].job.name,
      company: jobs[label.jobId].company?.name ?? '未填写公司',
      top: run.top.some((value) => value.jobId === label.jobId),
      score: pair.score,
      silver: label.ability,
      intent: label.intent,
      eligibility: label.eligibility,
      worthDiscussing: label.worthDiscussing,
      quoteVerified: label.evidenceQuoteVerified,
      reason: label.reason,
      candidateUrl: `http://localhost:23000/object/person/${candidate.id}`,
    });
  }
}
const payload = {
  rows,
  summary: {
    scored: report.overall.scoredTotal,
    failed: report.overall.failedTotal,
    expected: manifest.candidates.length * manifest.jobIds.length,
    top: report.overall.topWorthDiscussing,
    agreement: report.overall.pairwiseAgreement,
    quote: report.overall.exactEvidenceQuote,
    manifestHash: report.manifestHash,
    cost: report.measuredJev.reportedCostUSD,
    inputTokens: report.measuredJev.inputTokens,
    outputTokens: report.measuredJev.outputTokens,
    judgeInput: usage.inputTokens,
    judgeOutput: usage.outputTokens,
  },
};
const temporary = await mkdtemp(
  join(repository, '.local/recruiting/report-build-'),
);
try {
  const output = await build({
    entryPoints: [join(here, 'report.tsx')],
    bundle: true,
    write: false,
    minify: true,
    platform: 'browser',
    target: 'es2023',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const cssPath = join(temporary, 'report.css');
  execFileSync(
    join(here, 'node_modules/.bin/tailwindcss'),
    ['-i', join(here, 'report.css'), '-o', cssPath, '--minify'],
    { cwd: here, stdio: 'pipe' },
  );
  const css = await readFile(cssPath, 'utf8');
  const data = JSON.stringify(payload).replaceAll('<', '\\u003c');
  const script = output.outputFiles[0].text.replaceAll(
    /<\/script/gi,
    '<\\/script',
  );
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>泛函招聘匹配实验｜RSI 第一轮</title><style>${css}</style></head><body><div id="root"></div><noscript>请启用JavaScript查看离线交互表格；原始统计见同目录report.json。</noscript><script>window.recruitingReport=${data};${script}</script></body></html>`;
  await writeFile(join(directory, 'report.html'), html, { mode: 0o600 });
  console.log(
    JSON.stringify({
      output: '.local/recruiting/evaluations/rsi-v1/report.html',
      rows: rows.length,
      htmlBytes: Buffer.byteLength(html),
      externalRequests: 0,
    }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
