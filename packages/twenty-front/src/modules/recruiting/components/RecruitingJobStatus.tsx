/** Uses a consistent quiet color for stored job status without treating unknown as recruiting. */
import { t } from '@lingui/core/macro';
import { StyledRecruitingStatus } from './recruitingStyles';

type RecruitingJobStatusProps = { status?: string };
/** Distinguishes recruiting, closed, paused and missing status with text as well as color. */
export const RecruitingJobStatus = ({ status }: RecruitingJobStatusProps) => (
  <StyledRecruitingStatus
    data-tone={
      status === 'RECRUITING'
        ? 'green'
        : status === 'CLOSED'
          ? 'neutral'
          : status === 'PAUSED'
            ? 'yellow'
            : 'blue'
    }
  >
    {{ RECRUITING: t`在招`, CLOSED: t`已停招`, PAUSED: t`已暂停` }[
      status ?? ''
    ] ?? t`状态待确认`}
  </StyledRecruitingStatus>
);
