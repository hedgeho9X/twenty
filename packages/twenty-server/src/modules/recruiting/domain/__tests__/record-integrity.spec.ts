/** Tests trusted-state boundaries independently from role checks and model execution. */
import {
  sealRecruitingRecord,
  verifyRecruitingRecord,
} from '../record-integrity';

describe('recruiting record integrity', () => {
  const secret = 'unit-test-state-key';
  const intake = {
    id: 'intake',
    kind: 'CANDIDATE',
    state: 'READY',
    files: [{ fileId: 'file', label: 'resume.pdf' }],
    result: {
      schemaVersion: 2,
      input: { files: [{ fileId: 'file', label: 'resume.pdf' }] },
      actor: { userWorkspaceId: 'owner' },
      stage: 'QUEUED',
      optional: undefined,
    },
  };

  it('accepts native default values and readonly file presentation fields after a round trip', () => {
    const sealed = sealRecruitingRecord(
      'workspace',
      'recruitingIntake',
      intake,
      secret,
    );
    const read = {
      ...JSON.parse(JSON.stringify(sealed)),
      targetId: '',
      error: '',
      files: [
        {
          fileId: 'file',
          label: 'resume.pdf',
          url: 'signed-display-url',
          extension: 'pdf',
        },
      ],
      updatedAt: 'later',
    };
    expect(
      verifyRecruitingRecord('workspace', 'recruitingIntake', read, secret),
    ).toBe(true);
  });

  it('rejects raw-created, copied and edited queue instructions', () => {
    expect(
      verifyRecruitingRecord('workspace', 'recruitingIntake', intake, secret),
    ).toBe(false);
    const sealed = sealRecruitingRecord(
      'workspace',
      'recruitingIntake',
      intake,
      secret,
    );
    expect(
      verifyRecruitingRecord('other', 'recruitingIntake', sealed, secret),
    ).toBe(false);
    expect(
      verifyRecruitingRecord(
        'workspace',
        'recruitingIntake',
        { ...sealed, id: 'other' },
        secret,
      ),
    ).toBe(false);
    expect(
      verifyRecruitingRecord(
        'workspace',
        'recruitingIntake',
        { ...sealed, state: 'COMPLETED' },
        secret,
      ),
    ).toBe(false);
    expect(
      verifyRecruitingRecord(
        'workspace',
        'recruitingIntake',
        {
          ...sealed,
          result: {
            ...(sealed.result as object),
            actor: { userWorkspaceId: 'admin' },
          },
        },
        secret,
      ),
    ).toBe(false);
  });

  it('rejects a forged successful score while keeping ordinary CRM records editable', () => {
    const pair = {
      id: 'pair',
      candidateId: 'person',
      jobId: 'job',
      status: 'SCORED',
      payload: { score: 2.5, status: 'SCORED', cacheKey: 'hash' },
    };
    const sealed = sealRecruitingRecord(
      'workspace',
      'recruitingPairEvaluation',
      pair,
      secret,
    );
    expect(
      verifyRecruitingRecord(
        'workspace',
        'recruitingPairEvaluation',
        sealed,
        secret,
      ),
    ).toBe(true);
    expect(
      verifyRecruitingRecord(
        'workspace',
        'recruitingPairEvaluation',
        { ...sealed, payload: { ...(sealed.payload as object), score: 4 } },
        secret,
      ),
    ).toBe(false);
    expect(
      sealRecruitingRecord(
        'workspace',
        'company',
        { id: 'company', name: 'Editable' },
        secret,
      ),
    ).toEqual({ id: 'company', name: 'Editable' });
  });
});
