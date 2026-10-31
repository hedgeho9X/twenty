/** Seals server-owned task state so generic CRM writes cannot become trusted queue instructions. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { stableSerialize } from './match-context';

/** Protected objects retain native storage and permissions while authenticating their internal envelopes. */
const envelopeKeys: Record<string, string> = {
  recruitingIntake: 'result',
  recruitingMatchRun: 'payload',
  recruitingPairEvaluation: 'payload',
  recruitingDraft: 'payload',
};

/** Finds only the feature's internal state fields, never ordinary editable CRM records. */
export const recruitingEnvelopeKey = (object: string) => envelopeKeys[object];

/** Reduces formatted native FILES refs to persisted identity and label, excluding signed display URLs. */
const canonicalRecord = (
  workspaceId: string,
  object: string,
  record: Record<string, unknown>,
) => {
  const key = envelopeKeys[object];
  const value = record[key];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof record.id !== 'string'
  )
    throw new Error('Invalid internal record');
  const { integrity: _integrity, ...envelope } = value as Record<
    string,
    unknown
  >;
  const critical =
    object === 'recruitingIntake'
      ? {
          kind: record.kind,
          state: record.state,
          targetId: record.targetId || '',
          error: record.error || '',
          files: (Array.isArray(record.files) ? record.files : [])
            .map((file) => ({ fileId: file?.fileId, label: file?.label }))
            .sort((a, b) =>
              String(a.fileId).localeCompare(String(b.fileId), 'en'),
            ),
        }
      : object === 'recruitingMatchRun'
        ? {
            direction: record.direction,
            subjectId: record.subjectId,
            status: record.status,
          }
        : object === 'recruitingDraft'
          ? {
              kind: record.kind,
              candidateId: record.candidateId || '',
              jobId: record.jobId || '',
              status: record.status,
              title: record.title || '',
              body: record.body || '',
              error: record.error || '',
            }
          : {
              candidateId: record.candidateId,
              jobId: record.jobId,
              status: record.status,
            };
  return JSON.parse(
    JSON.stringify({ workspaceId, object, id: record.id, critical, envelope }),
  ) as Record<string, unknown>;
};

/** Authenticates the same JSON representation that survives native database serialization. */
const signature = (
  workspaceId: string,
  object: string,
  record: Record<string, unknown>,
  secret: string,
) =>
  createHmac('sha256', secret)
    .update(
      `recruiting-state-v1:${stableSerialize(canonicalRecord(workspaceId, object, record))}`,
    )
    .digest();

/** Adds a purpose-bound signature after trusted code creates a checkpoint or model result. */
export const sealRecruitingRecord = (
  workspaceId: string,
  object: string,
  record: Record<string, unknown>,
  secret: string,
): Record<string, unknown> => {
  const key = envelopeKeys[object];
  if (!key) return record;
  return {
    ...record,
    [key]: {
      ...(record[key] as Record<string, unknown>),
      integrity: {
        version: 1,
        signature: signature(workspaceId, object, record, secret).toString(
          'hex',
        ),
      },
    },
  };
};

/** Rejects copied, edited or unsigned envelopes before they can authorize file reads or paid evaluation. */
export const verifyRecruitingRecord = (
  workspaceId: string,
  object: string,
  record: Record<string, unknown>,
  secret: string,
): boolean => {
  if (!envelopeKeys[object]) return true;
  try {
    const envelope = record[envelopeKeys[object]] as Record<string, unknown>;
    const integrity = envelope.integrity as
      | { version?: number; signature?: string }
      | undefined;
    if (integrity?.version !== 1 || typeof integrity.signature !== 'string')
      return false;
    const supplied = Buffer.from(integrity.signature, 'hex');
    const expected = signature(workspaceId, object, record, secret);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  } catch {
    return false;
  }
};
