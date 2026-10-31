/** Calls the capability-only portal without inheriting a native browser session or putting secrets in URLs. */
import { saveAs } from 'file-saver';
import { t } from '@lingui/core/macro';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

/** Uses a JSON body capability so server URLs, referrers and native auth middleware do not receive it. */
const portalResponse = async (
  token: string,
  input: object,
  signal?: AbortSignal,
) => {
  const response = await fetch(
    `${REACT_APP_SERVER_BASE_URL.replace(/\/$/, '')}/recruiting-portal`,
    {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...input }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) {
    const body = await response.json();
    throw new Error(
      typeof body.message === 'string'
        ? body.message
        : t`入口暂不可用，请联系运营人员`,
    );
  }
  return response;
};
/** Reads only the explicit public DTO returned by the scoped service. */
export const portalRequest = async <T>(
  token: string,
  input: object,
  signal?: AbortSignal,
): Promise<T> =>
  (await portalResponse(token, input, signal)).json() as Promise<T>;
/** Downloads approved source bytes as an attachment rather than opening untrusted HTML in the portal origin. */
export const portalDownload = async (
  token: string,
  fileId: string,
  filename: string,
) =>
  saveAs(
    await (await portalResponse(token, { action: 'download', fileId })).blob(),
    filename,
  );
