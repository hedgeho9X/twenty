/** Distinguishes stale results, changed access and pending work from real failures. */
import { matchResultNotice } from '@/recruiting/matching/utils/resultNotice';
import { type RecruitingMatchRun } from '@/recruiting/matching/types/MatchRun';
const run = { status: 'COMPLETED', complete: false } as RecruitingMatchRun;
it('does not invent a processing error from complete=false alone', () => {
  expect(matchResultNotice(run)).toBeUndefined();
});
it.each([
  [{ stale: 8 }, '资料已更新'],
  [{ inaccessible: 1 }, '无权查看'],
  [{ poolChanged: true }, '范围已变化'],
  [{ status: 'PROCESSING' }, '处理中'],
  [{ status: 'PARTIAL' }, '部分匹配'],
])('explains a concrete nonfailure condition: %j', (patch, text) => {
  expect(matchResultNotice({ ...run, ...patch })).toEqual({
    error: false,
    message: expect.stringContaining(text),
  });
});
it('keeps real worker errors visible', () => {
  expect(
    matchResultNotice({ ...run, status: 'FAILED', error: '模型调用失败' }),
  ).toEqual({ error: true, message: '模型调用失败' });
});
