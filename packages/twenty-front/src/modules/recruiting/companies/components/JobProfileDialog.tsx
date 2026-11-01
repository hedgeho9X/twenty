/** Shows the persisted job extraction using the same renderer as intake details. */
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Dialog } from 'twenty-ui/primitives/surfaces';
import { IconX } from 'twenty-ui/icon';
import { useRecruitingQuery } from '@/recruiting/shared/hooks/useRecruitingQuery';
import { RecruitingParsedProfile } from '@/recruiting/shared/components/ParsedProfile';
import {
  recruitingDialogClass,
  StyledRecruitingError,
  StyledRecruitingMuted,
  StyledRecruitingRow,
} from '@/recruiting/shared/styles';

export const JobProfileDialog = ({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) => {
  const query = useRecruitingQuery<{
    name: string;
    recruitingProfile?: unknown;
  }>(`jobs/${id}`);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <div className={recruitingDialogClass}>
            <Dialog.Popup size="xl">
              <Dialog.Header>
                <StyledRecruitingRow
                  style={{ justifyContent: 'space-between' }}
                >
                  <Dialog.Title>{t`岗位解析资料`}</Dialog.Title>
                  <Button
                    variant="ghost"
                    aria-label={t`关闭岗位资料`}
                    onClick={onClose}
                  >
                    <IconX size={16} />
                  </Button>
                </StyledRecruitingRow>
              </Dialog.Header>
              <Dialog.Body>
                {query.error ? (
                  <StyledRecruitingError role="alert">
                    {query.error}
                  </StyledRecruitingError>
                ) : query.data?.recruitingProfile ? (
                  <RecruitingParsedProfile
                    kind="JOB"
                    profile={query.data.recruitingProfile}
                  />
                ) : (
                  <StyledRecruitingMuted>
                    {query.loading ? t`正在读取…` : t`该岗位尚无解析资料`}
                  </StyledRecruitingMuted>
                )}
              </Dialog.Body>
            </Dialog.Popup>
          </div>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
