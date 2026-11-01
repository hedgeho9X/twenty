/** Tests trusted-state boundaries independently from role checks and model execution. */
import {
  sealRecruitingRecord,
  verifyRecruitingRecord,
} from '../record-integrity';
import { RECRUITING_MAIL_FILE_LAYOUT } from '../mail-file-layout';

describe('recruiting record integrity', () => {
  const secret = 'unit-test-state-key';
  it('keeps old mail MACs readable and authenticates every native ownership slot after migration', () => {
    const legacy = {
      id: 'mail',
      status: 'READY',
      sourceHash: 'sha',
      payload: { version: 1, intakeIds: ['accepted'] },
    };
    const old = sealRecruitingRecord(
      'workspace',
      'recruitingMailArchive',
      legacy,
      secret,
    );
    expect(
      verifyRecruitingRecord(
        'workspace',
        'recruitingMailArchive',
        { ...old, sourceFiles: [] },
        secret,
      ),
    ).toBe(true);
    const migrated = sealRecruitingRecord(
      'workspace',
      'recruitingMailArchive',
      {
        ...legacy,
        payload: { ...legacy.payload, fileOwnershipVersion: 1 },
        sourceFiles: [{ fileId: 'canonical', label: 'original.eml' }],
      },
      secret,
    );
    expect(
      verifyRecruitingRecord(
        'workspace',
        'recruitingMailArchive',
        {
          ...migrated,
          sourceFiles: [
            {
              fileId: 'canonical',
              label: 'original.eml',
              url: 'presentation-only',
            },
          ],
        },
        secret,
      ),
    ).toBe(true);
    for (const slot of RECRUITING_MAIL_FILE_LAYOUT.fields)
      expect(
        verifyRecruitingRecord(
          'workspace',
          'recruitingMailArchive',
          { ...migrated, [slot]: [{ fileId: 'other', label: 'changed' }] },
          secret,
        ),
      ).toBe(false);
  });
  it('protects approved draft text and normalizes native empty UUID and text defaults', () => {
    const draft = {
      id: 'draft',
      kind: 'GREETING',
      candidateId: 'person',
      status: 'APPROVED',
      body: 'reviewed text',
      payload: {
        input: { candidateId: 'person' },
        approvedAt: '2026-11-01T00:00:00Z',
      },
    };
    const sealed = sealRecruitingRecord(
      'workspace',
      'recruitingDraft',
      draft,
      secret,
    );
    expect(
      verifyRecruitingRecord(
        'workspace',
        'recruitingDraft',
        { ...sealed, jobId: null, title: '', error: '' },
        secret,
      ),
    ).toBe(true);
    expect(
      verifyRecruitingRecord(
        'workspace',
        'recruitingDraft',
        { ...sealed, body: 'unreviewed replacement' },
        secret,
      ),
    ).toBe(false);
  });
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
