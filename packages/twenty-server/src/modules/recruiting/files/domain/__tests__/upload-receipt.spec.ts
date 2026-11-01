/** Tests cross-principal, tampering and expiry boundaries without storage or account credentials. */
import {
  signRecruitingUploadReceipt,
  verifyRecruitingUploadReceipt,
} from '../upload-receipt';

describe('recruiting upload receipt', () => {
  const secret = 'unit-test-only-key';
  const payload = {
    version: 1 as const,
    workspaceId: 'workspace',
    principalHash: 'caller',
    fileId: 'new-file',
    label: '简历.pdf',
    expiresAt: Date.now() + 3600_000,
  };
  const expected = { workspaceId: 'workspace', principalHash: 'caller' };

  it('retains the server-created identity without embedding an account secret', () => {
    const receipt = signRecruitingUploadReceipt(payload, secret);
    expect(verifyRecruitingUploadReceipt(receipt, expected, secret)).toEqual(
      payload,
    );
    expect(receipt).not.toContain(secret);
  });

  it('rejects modified content, another principal, another workspace and expired receipts', () => {
    const receipt = signRecruitingUploadReceipt(payload, secret);
    expect(() =>
      verifyRecruitingUploadReceipt(
        `${receipt.slice(0, 20)}a${receipt.slice(21)}`,
        expected,
        secret,
      ),
    ).toThrow();
    expect(() =>
      verifyRecruitingUploadReceipt(
        receipt,
        { ...expected, workspaceId: 'other' },
        secret,
      ),
    ).toThrow();
    expect(() =>
      verifyRecruitingUploadReceipt(
        receipt,
        { ...expected, principalHash: 'other' },
        secret,
      ),
    ).toThrow();
    expect(() =>
      verifyRecruitingUploadReceipt(
        signRecruitingUploadReceipt(
          { ...payload, expiresAt: Date.now() - 1 },
          secret,
        ),
        expected,
        secret,
      ),
    ).toThrow();
    expect(() =>
      verifyRecruitingUploadReceipt(receipt, expected, 'different-key'),
    ).toThrow();
  });
});
