/** Runs real HTTP parsing of synthetic scans, long documents and invalid files; original recruiting data is never modified. */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { v5 } from 'uuid';
import assert from 'node:assert/strict';

const root = '.local/recruiting/parser-regression-v2';
const environment = JSON.parse(
  await readFile('.local/recruiting/environment.json', 'utf8'),
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Normalizes Markdown escaping and layout whitespace while retaining exact project, date and technology values. */
function normalizeTableCell(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/\\([\\_*|])/g, '$1')
    .replace(/\s+/g, '');
}

/** Reads data rows only after a three-column Markdown table delimiter, preserving cell and row boundaries. */
function markdownTableRows(text) {
  const rows = [];
  let inTable = false;
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = trimmed
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map(normalizeTableCell);
    if (cells.length === 3 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      inTable = true;
      continue;
    }
    if (inTable && cells.length === 3) rows.push(cells);
  }
  return rows;
}

let resourceRequests = 0;
const counter = createServer((_request, response) => {
  resourceRequests++;
  response.setHeader('content-type', 'image/png');
  response.end(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=',
      'base64',
    ),
  );
});
await new Promise((done) => counter.listen(0, '0.0.0.0', done));
const port = counter.address().port;
const target = `http://host.docker.internal:${port}/resource`;
await promisify(execFile)(
  'docker',
  [
    'exec',
    'twenty-recruiting-parser-1',
    'python',
    '-c',
    `import urllib.request;urllib.request.urlopen('${target}',timeout=5).read()`,
  ],
  { encoding: 'utf8' },
);
assert.equal(resourceRequests, 1);
resourceRequests = 0;
const cases = [
  {
    filename: 'scan-chinese.png',
    status: 200,
    pages: 1,
    words: ['后端工程师', 'TypeScript', 'PostgreSQL'],
  },
  {
    filename: 'scan-chinese.pdf',
    status: 200,
    pages: 2,
    words: ['后端工程师', 'ARCHIVE_END'],
  },
  {
    filename: 'resume-two-pages.docx',
    status: 200,
    pages: 2,
    words: ['WORD_LAST_SECTION'],
  },
  {
    filename: 'resume-two-pages.doc',
    status: 200,
    pages: 2,
    words: ['WORD_LAST_SECTION'],
  },
  {
    filename: 'table-resume.docx',
    status: 200,
    pages: 2,
    words: ['TABLE_LAST_SECTION'],
    tableRows: [
      ['PROJECT_ALPHA', '2020-2021', 'TypeScript'],
      ['PROJECT_BETA', '2022-2023', 'Rust'],
    ],
  },
  {
    filename: 'long-resume.html',
    status: 200,
    multiple: true,
    words: ['HTML_LAST_SECTION'],
  },
  {
    filename: 'long-resume.md',
    status: 200,
    multiple: true,
    words: ['MARKDOWN_LAST_SECTION'],
  },
  {
    filename: 'external-resource.html',
    status: 200,
    needsReview: true,
    words: ['TypeScript'],
  },
  { filename: 'encrypted.pdf', status: 422 },
  { filename: 'corrupt.pdf', status: 422 },
  { filename: 'corrupt.docx', status: 422 },
];
const report = [];
await mkdir('.local/recruiting/storage/_recruiting-regression-v2', {
  recursive: true,
  mode: 0o700,
});
try {
  for (const item of cases) {
    let bytes = await readFile(join(root, item.filename));
    if (item.needsReview)
      bytes = Buffer.from(
        bytes
          .toString('utf8')
          .replace('http://127.0.0.1:1/must-not-load', target),
      );
    const storageKey = `_recruiting-regression-v2/${item.filename}`;
    await writeFile(join('.local/recruiting/storage', storageKey), bytes, {
      mode: 0o600,
    });
    const requestId = v5(
      `parser-regression-v3-all-layers:${item.filename}:${hash(bytes)}`,
      v5.URL,
    );
    const started = Date.now();
    const response = await fetch('http://127.0.0.1:23003/parse', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${environment.RECRUITING_PARSER_TOKEN}`,
      },
      body: JSON.stringify({
        requestId,
        storageKey,
        originalName: item.filename,
        sha256: hash(bytes),
      }),
      signal: AbortSignal.timeout(180000),
    });
    const result = await response.json();
    const row = {
      filename: item.filename,
      requestId,
      httpStatus: response.status,
      expectedStatus: item.status,
      pages: result.pages,
      status: result.status,
      coverage: result.coverage,
      elapsedMs: Date.now() - started,
      sourceHash: hash(bytes),
      words: (item.words ?? []).map((word) => ({
        word,
        exact: String(result.text).includes(word),
        present: String(result.text)
          .normalize('NFKC')
          .replace(/[\s\\_]+/g, '')
          .includes(word.normalize('NFKC').replace(/[\s\\_]+/g, '')),
      })),
      ...(item.tableRows
        ? {
            tableRows: item.tableRows.map((expected) => ({
              expected,
              matched: markdownTableRows(result.text).some((cells) =>
                cells.every(
                  (cell, index) => cell === normalizeTableCell(expected[index]),
                ),
              ),
            })),
          }
        : {}),
    };
    await writeFile(
      join(root, `${item.filename}.result.json`),
      JSON.stringify(result),
      { mode: 0o600 },
    );
    row.passed = response.status === item.status;
    if (response.ok) {
      row.passed &&=
        result.sourceHash === hash(bytes) &&
        result.pages === result.previews.length &&
        row.words.every((word) => word.present);
      if (item.pages) row.passed &&= result.pages === item.pages;
      if (item.tableRows)
        row.passed &&=
          result.coverage === 'all_pages' &&
          row.tableRows.every((tableRow) => tableRow.matched);
      if (item.multiple) row.passed &&= result.pages > 1;
      if (item.needsReview)
        row.passed &&=
          result.status === 'needs_review' &&
          result.missingResources > 0 &&
          !result.text.includes('UNSAFE_EXECUTED') &&
          resourceRequests === 0;
      else row.passed &&= result.status === 'complete';
      for (const preview of result.previews) {
        const image = await readFile(
          join('.local/recruiting/parser-output', requestId, preview),
        );
        row.passed &&=
          image.length > 8 &&
          image
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      }
    }
    report.push(row);
    console.log(JSON.stringify(row));
    await writeFile(
      join(root, 'report.json'),
      JSON.stringify(
        {
          externalReachabilityVerified: true,
          parserExternalRequests: resourceRequests,
          cases: report,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
} finally {
  counter.closeAllConnections();
  await new Promise((done) => counter.close(done));
}
if (report.some((row) => !row.passed)) process.exitCode = 2;
