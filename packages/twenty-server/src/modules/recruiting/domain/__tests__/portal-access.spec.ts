/** Tests capability integrity independently of public routes and native record permissions. */
import {
  signPortalAccess,
  verifyPortalAccess,
  type RecruitingPortalAccess,
} from '../portal-access';

const scope: RecruitingPortalAccess = {
  version: 1,
  purpose: 'recruiting-portal',
  inviteId: '75d852bf-6536-405d-a3fb-05f05fb04ac7',
  actor: {
    workspaceId: '096e9c2b-3591-414d-ac3d-1b2e8ef994ce',
    userWorkspaceId: '551cc294-4995-44c0-ac3d-bbc243f1c586',
  },
  nonce: 'a'.repeat(64),
  expiresAt: 2000,
};
const secret = 'unit-test-only-portal-key';

it('preserves bounded actor scope and is deterministic for idempotent link retrieval', () => {
  const token = signPortalAccess(scope, secret);
  expect(verifyPortalAccess(token, secret, 1000)).toEqual(scope);
  expect(signPortalAccess(JSON.parse(JSON.stringify(scope)), secret)).toBe(
    token,
  );
  expect(token.split('.')).toHaveLength(2);
});

it('rejects tampering, expiry, key changes and native-token-shaped input before record access', () => {
  const token = signPortalAccess(scope, secret);
  const [body, signature] = token.split('.');
  const changed = Buffer.from(
    JSON.stringify({ ...scope, expiresAt: 99999999 }),
  ).toString('base64url');
  for (const invalid of [
    `${changed}.${signature}`,
    `${body}.${signature.slice(1)}`,
    'native.jwt.token',
  ])
    expect(() => verifyPortalAccess(invalid, secret, 1000)).toThrow();
  expect(() => verifyPortalAccess(token, secret, 2000)).toThrow();
  expect(() => verifyPortalAccess(token, 'another-key', 1000)).toThrow();
  expect(() =>
    signPortalAccess(
      { ...scope, actor: { workspaceId: scope.actor.workspaceId } },
      secret,
    ),
  ).toThrow();
});
