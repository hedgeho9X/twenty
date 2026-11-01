/** Explains result freshness separately from processing failures. */
import { t } from '@lingui/core/macro';
import { type RecruitingMatchRun } from '@/recruiting/matching/types/MatchRun';

/** Returns an actionable explanation only when the response identifies a concrete condition. */
export const matchResultNotice = (run: RecruitingMatchRun) => {
  if (run.error || run.status === 'FAILED')
    return {
      error: true,
      message: run.error || t`匹配处理失败，请检查错误信息后重新尝试。`,
    };
  if (run.stale)
    return {
      error: false,
      message: t`资料已更新，旧评分已失效。请重新匹配以查看最新结果。`,
    };
  if (run.inaccessible)
    return {
      error: false,
      message: t`部分资料已删除或当前无权查看，对应结果已隐藏。`,
    };
  if (run.poolChanged)
    return {
      error: false,
      message: t`可匹配的候选人或岗位范围已变化，当前结果来自上次匹配。`,
    };
  if (['QUEUED', 'PROCESSING'].includes(run.status))
    return { error: false, message: t`匹配进行中，结果会自动更新。` };
  if (run.status === 'PARTIAL')
    return {
      error: false,
      message: t`部分匹配尚未完成，已完成的结果显示如下。`,
    };
  return undefined;
};
