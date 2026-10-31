/** Binds a newly created native upload to one workspace and principal without storing a session token. */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** A submission capability carries no authentication secret or upstream model credential. */
export type RecruitingUploadReceipt = {
  version: 1;
  workspaceId: string;
  principalHash: string;
  fileId: string;
  label: string;
  expiresAt: number;
};

/** Signs only server-created file identities; callers cannot mint a receipt for an existing foreign file. */
export const signRecruitingUploadReceipt = (
  payload: RecruitingUploadReceipt,
  secret: string,
): string => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(`recruiting-upload-v1:${encoded}`).digest('base64url')}`;
};

/** Rejects changes, expiry and cross-principal reuse before any file content is read. */
export const verifyRecruitingUploadReceipt = (
  receipt: string,
  expected: { workspaceId: string; principalHash: string },
  secret: string,
): RecruitingUploadReceipt => {
  try {
    if (receipt.length > 4096) throw new Error();
    const [encoded, signature, extra] = receipt.split('.');
    if (!encoded || !signature || extra) throw new Error();
    const supplied = Buffer.from(signature, 'base64url');
    const actual = createHmac('sha256', secret)
      .update(`recruiting-upload-v1:${encoded}`)
      .digest();
    if (supplied.length !== actual.length || !timingSafeEqual(supplied, actual))
      throw new Error();
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as RecruitingUploadReceipt;
    if (
      payload.version !== 1 ||
      payload.workspaceId !== expected.workspaceId ||
      payload.principalHash !== expected.principalHash ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now() ||
      payload.expiresAt > Date.now() + 24 * 60 * 60_000 + 60_000 ||
      typeof payload.fileId !== 'string' ||
      typeof payload.label !== 'string'
    )
      throw new Error();
    return payload;
  } catch {
    throw new Error('上传提交凭据无效或已过期，请重新上传材料');
  }
};
