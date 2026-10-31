/** Displays frozen, anonymized matching evidence without calling models or exposing original resumes. */
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './components/card';
import {
  Table,
  TableCaption,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './components/table';
import { Button } from './components/button';
import { Badge } from './components/badge';

/** Contains selected display facts only; original materials and credential-bearing URLs are excluded by the builder. */
type EvidenceRow = {
  pairId: string;
  candidate: string;
  split: string;
  job: string;
  company: string;
  top: boolean;
  score: number;
  silver: number;
  intent: string;
  eligibility: string;
  worthDiscussing: boolean;
  quoteVerified: boolean;
  reason: string;
  candidateUrl: string;
};
declare global {
  interface Window {
    recruitingReport: {
      rows: EvidenceRow[];
      summary: {
        scored: number;
        failed: number;
        expected: number;
        top: { numerator: number; denominator: number };
        agreement: { numerator: number; denominator: number };
        quote: { numerator: number; denominator: number };
        manifestHash: string;
        cost: number;
        inputTokens: number;
        outputTokens: number;
        judgeInput: number;
        judgeOutput: number;
      };
    };
  }
}

/** Escapes spreadsheet formula prefixes and quotes when users explicitly export the current view. */
const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
};
/** Writes only the visible anonymous table, never source documents, mail or authorization data. */
const download = (rows: EvidenceRow[]) => {
  const values = [
    [
      '候选人',
      '组别',
      '岗位',
      '公司',
      'Jev前五',
      'Jev能力分',
      '机器初审能力分',
      '机器初审条件',
      '机器初审可沟通',
    ],
    ...rows.map((r) => [
      r.candidate,
      r.split,
      r.job,
      r.company,
      r.top,
      r.score,
      r.silver,
      r.eligibility,
      r.worthDiscussing,
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(
      [
        String.fromCharCode(0xfeff),
        values
          .map((row) => row.map(csvCell).join(','))
          .join(String.fromCharCode(13, 10)),
      ],
      { type: 'text/csv;charset=utf-8' },
    ),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'recruiting-rsi-anonymous.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
/** Keeps filtering and numeric sorting local so the report remains usable without any network service. */
const Report = () => {
  const { rows, summary } = window.recruitingReport;
  const [candidate, setCandidate] = useState('全部');
  const [ascending, setAscending] = useState(false);
  const candidates = [...new Set(rows.map((row) => row.candidate))];
  const visible = useMemo(
    () =>
      rows
        .filter((row) => candidate === '全部' || row.candidate === candidate)
        .toSorted(
          (a, b) =>
            (ascending ? 1 : -1) * (a.score - b.score) ||
            a.candidate.localeCompare(b.candidate),
        ),
    [rows, candidate, ascending],
  );
  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-6 p-6 md:p-10">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          TWENTY · 本地招聘实验 / 2026-11-01
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          人岗匹配，逐项核对
        </h1>
        <p className="text-muted-foreground">
          冻结8人 × 46真岗。比较的是模型判断与材料证据，实际推荐仍需人确认。
        </p>
      </header>
      <section className="grid gap-4 md:grid-cols-4" aria-label="实验概览">
        {[
          [
            `${summary.scored} / ${summary.expected}`,
            '真实Jev评分',
            `${summary.failed}次调用失败`,
          ],
          [
            `${summary.top.numerator} / ${summary.top.denominator}`,
            '初审认为前五值得沟通',
            '机器标签，不是招聘准确率',
          ],
          [
            `${summary.agreement.numerator} / ${summary.agreement.denominator}`,
            '非平局排序一致',
            '只检查选中人岗对',
          ],
          [
            `${summary.quote.numerator} / ${summary.quote.denominator}`,
            '初审引用逐字核对通过',
            '理由需人工核实',
          ],
        ].map(([value, title, description]) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <strong className="text-3xl">{value}</strong>
            </CardContent>
            <CardFooter className="text-xs text-muted-foreground">
              独立模型初审 ≠ 人工标准答案
            </CardFooter>
          </Card>
        ))}
      </section>
      <Card>
        <CardHeader>
          <CardTitle>56组已盲评的人岗对</CardTitle>
          <CardDescription>
            每人前五加两个固定对照，初审看不到Jev分数或排名。点击编号筛选，点击分数表头排序。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <nav className="flex flex-wrap gap-2" aria-label="按候选人筛选">
            {['全部', ...candidates].map((value) => (
              <Button
                key={value}
                variant={value === candidate ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={value === candidate}
                onClick={() => setCandidate(value)}
              >
                {value}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => download(visible)}
            >
              导出当前表格
            </Button>
          </nav>
          <p
            aria-live="polite"
            className="text-sm text-muted-foreground"
            id="visible-count"
          >
            当前 {visible.length} 对
          </p>
          <Table>
            <TableCaption>
              能力分0–4；待确认条件不能当作不符合。所有文字理由均来自独立模型，Jev没有生成自由文本解释。
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>候选人</TableHead>
                <TableHead>岗位 / 公司</TableHead>
                <TableHead>分组</TableHead>
                <TableHead>入围</TableHead>
                <TableHead aria-sort={ascending ? 'ascending' : 'descending'}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAscending(!ascending)}
                  >
                    Jev能力分 {ascending ? '↑' : '↓'}
                  </Button>
                </TableHead>
                <TableHead>初审能力</TableHead>
                <TableHead>初审条件</TableHead>
                <TableHead>初审可沟通</TableHead>
                <TableHead>核对说明</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.pairId} data-evidence-row="true">
                  <TableCell>
                    <a href={row.candidateUrl} target="_blank" rel="noreferrer">
                      {row.candidate}
                    </a>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-72 text-wrap">
                      {row.job}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.company}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.split === 'holdout' ? '首轮保留组' : '首轮调优组'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.top ? 'secondary' : 'outline'}>
                      {row.top ? '前五' : '对照'}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.score.toFixed(2)}</TableCell>
                  <TableCell>{row.silver}</TableCell>
                  <TableCell>
                    {{
                      eligible: '符合已知条件',
                      unknown: '待确认',
                      conflict: '初审判冲突',
                    }[row.eligibility] ?? row.eligibility}
                  </TableCell>
                  <TableCell>
                    {row.worthDiscussing ? '可继续核实' : '暂不建议'}
                  </TableCell>
                  <TableCell>
                    <details>
                      <summary>查看初审</summary>
                      <div className="max-w-80 text-wrap py-3 text-sm">
                        <p>{row.reason}</p>
                        <p className="mt-2 text-muted-foreground">
                          原文引用：
                          {row.quoteVerified
                            ? '逐字匹配'
                            : '未逐字匹配，不能当证据'}
                        </p>
                      </div>
                    </details>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter className="text-sm text-muted-foreground">
          偏好远程的一例被机器初审判为冲突；原件没有明确拒绝线下，已另存核对意见，保留原标签。
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>成本、版本与局限</CardTitle>
          <CardDescription>
            先冻结输入与协议，再生成标签。结果查看后，这8人只能作为已见回归集。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            Jev 上报 ${summary.cost.toFixed(9)}；输入{' '}
            {summary.inputTokens.toLocaleString()} / 输出{' '}
            {summary.outputTokens.toLocaleString()} tokens。独立订阅初审输入{' '}
            {summary.judgeInput.toLocaleString()} / 输出{' '}
            {summary.judgeOutput.toLocaleString()} tokens，订阅用量不是零成本。
          </p>
          <p>
            协议
            match-v0.1/context-v2/eligibility-v3；解析文字冻结为preview-v1。图片已生成，但本轮盲评没有输入截图；新preview-v2解析修复不回写旧实验。
          </p>
          <p>
            样本小，按前五及两个对照选对；无法估计全库召回率。没有程序排除观测，误拒率未知。未由业务方确认标签，未完成浏览器视觉验收。
          </p>
          <p className="break-all text-muted-foreground">
            manifest SHA256：{summary.manifestHash}
          </p>
          <a
            href="https://ui.shadcn.com/docs/components/table"
            target="_blank"
            rel="noreferrer"
          >
            Table、Card、Button、Badge 使用 Shadcn/ui 组件源码
          </a>
        </CardContent>
        <CardFooter>
          本文件离线运行；点击候选人记录需要本地Twenty登录。
        </CardFooter>
      </Card>
    </main>
  );
};
createRoot(document.getElementById('root')!).render(<Report />);
