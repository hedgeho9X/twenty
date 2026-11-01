import { useState } from 'react';
import { SourceMaterialView } from '@/recruiting/shared/components/SourceMaterialView';
/** Shows the persisted job extraction using the same renderer as intake details. */
import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/primitives/input';
import { Dialog } from 'twenty-ui/primitives/surfaces';
import { IconArrowLeft, IconX } from 'twenty-ui/icon';
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
  const [showSource, setShowSource] = useState(false);
  const query = useRecruitingQuery<{
    name: string;
    recruitingProfile?: { sourceIntakeId?: string; [key: string]: unknown };
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
                  <StyledRecruitingRow>
                    {showSource && (
                      <Button
                        variant="ghost"
                        aria-label={t`返回解析详情`}
                        startIcon={<IconArrowLeft size={16} />}
                        onClick={() => setShowSource(false)}
                      >{t`返回`}</Button>
                    )}
                    <Dialog.Title>
                      {showSource ? t`原始材料` : t`岗位解析资料`}
                    </Dialog.Title>
                  </StyledRecruitingRow>
                  <Button
                    variant="ghost"
                    aria-label={t`关闭岗位资料`}
                    onClick={onClose}
                  >
                    <IconX size={16} />
                  </Button>
                </StyledRecruitingRow>
              </Dialog.Header>
              <Dialog.Body key={showSource ? 'source' : 'details'}>
                {showSource && query.data?.recruitingProfile?.sourceIntakeId ? (
                  <SourceMaterialView
                    intakeId={query.data.recruitingProfile.sourceIntakeId}
                  />
                ) : query.error ? (
                  <StyledRecruitingError role="alert">
                    {query.error}
                  </StyledRecruitingError>
                ) : query.data?.recruitingProfile ? (
                  <>
                    <RecruitingParsedProfile
                      kind="JOB"
                      profile={query.data.recruitingProfile}
                    />
                    {query.data.recruitingProfile.sourceIntakeId && (
                      <Button
                        variant="ghost"
                        onClick={() => setShowSource(true)}
                      >{t`原始材料`}</Button>
                    )}
                  </>
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
