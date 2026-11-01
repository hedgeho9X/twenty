/** Names independent material and matching states without conflating storage with scoring success. */
import { t } from '@lingui/core/macro';

/** Maps the actual saved business stage to a concise operator label. */
export const recruitingTaskLabel = (state: string) =>
  ({
    MATCHING: t`匹配中`,
    MATCH_FAILED: t`匹配失败`,
    MATCH_STALE: t`需要重新匹配`,
    SCORED: t`已评分`,
    EXCLUDED: t`条件不符`,
    READY: t`待处理`,
    QUEUED: t`排队中`,
    PROCESSING: t`匹配中`,
    PARSING: t`解析文件`,
    EXTRACTING: t`整理资料`,
    EXTRACTED: t`资料已整理`,
    COPYING_FILES: t`保存附件`,
    SAVING_JOBS: t`创建岗位`,
    STORED: t`已入库`,
    AWAITING_CONFIRMATION: t`待确认岗位`,
    CONFIRMATION_PARTIAL: t`部分岗位待修正`,
    IDENTITY_REVIEW: t`待核对身份`,
    MATERIAL_REVIEW: t`待核对材料`,
    NEEDS_REVIEW: t`待核对`,
    FAILED: t`失败`,
    COMPLETED: t`匹配完成`,
    MATCH_DISABLED: t`已入库·未匹配`,
    PARTIAL: t`部分结果`,
    NO_RESULTS: t`无匹配结果`,
    SUPERSEDED: t`资料已更新`,
    DISCARDED: t`已取消`,
    DISABLED: t`未开启`,
    FAILED_TO_QUEUE: t`排队失败`,
  })[state] ?? state;

/** Historical missing provenance remains unknown instead of being inferred from an account name. */
export const recruitingChannelLabel = (source?: string) =>
  ({ manual: t`人工`, api: 'Agent', email: t`邮件`, system: t`自动` })[
    source ?? ''
  ] ?? '—';

/** Gives the same semantic state color to queue and detail views. */
export const recruitingTaskTone = (state: string) =>
  ['STORED', 'COMPLETED'].includes(state)
    ? 'green'
    : ['FAILED', 'FAILED_TO_QUEUE', 'MATCH_FAILED'].includes(state)
      ? 'red'
      : [
            'PARTIAL',
            'NEEDS_REVIEW',
            'IDENTITY_REVIEW',
            'MATERIAL_REVIEW',
            'AWAITING_CONFIRMATION',
            'CONFIRMATION_PARTIAL',
            'SUPERSEDED',
            'NO_RESULTS',
          ].includes(state)
        ? 'yellow'
        : 'blue';
