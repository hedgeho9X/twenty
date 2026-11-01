/** Calls the shared recruiting boundary using the official cookie session, with no frontend API keys. */
import { SESSION_COOKIE_OPT_IN_HEADER_NAME } from 'twenty-shared/constants';
import { REACT_APP_SERVER_BASE_URL } from '~/config/index';
import { type RecruitingUpload } from '@/recruiting/intake/types/Upload';
import { t } from '@lingui/core/macro';
import { saveAs } from 'file-saver';

/** Preserves server errors without exposing stack traces or transport headers. */
const recruitingResponse = async (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  headers.set(SESSION_COOKIE_OPT_IN_HEADER_NAME, '1');
  const response = await fetch(
    `${REACT_APP_SERVER_BASE_URL.replace(/\/$/, '')}/recruiting/${path}`,
    {
      ...options,
      redirect: 'error',
      credentials: 'include',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
      headers,
    },
  );
  if (!response.ok) {
    const body: unknown = await response.json();
    const message =
      body && typeof body === 'object' && 'message' in body
        ? body.message
        : undefined;
    throw new Error(
      typeof message === 'string'
        ? message
        : t`请求未完成，请检查权限或稍后重试`,
    );
  }
  return response;
};

/** Reads JSON only after native session authorization and error handling succeed. */
export const recruitingRequest = async <T>(
  path: string,
  options: RequestInit = {},
): Promise<T> => (await recruitingResponse(path, options)).json() as Promise<T>;

/** Fetches private binary artifacts with the same cookie opt-in as ordinary recruiting API requests. */
export const recruitingBlob = async (path: string): Promise<Blob> =>
  (await recruitingResponse(path)).blob();

/** Downloads untrusted source bytes without opening an executable HTML document in the CRM origin. */
export const downloadRecruitingArtifact = async (
  path: string,
  filename: string,
) => saveAs(await recruitingBlob(path), filename);

/** Uses native upload targets and quarantine completion while retaining a caller-bound submission receipt. */
export const uploadRecruitingFile = async (
  file: File,
): Promise<RecruitingUpload> => {
  const target = await recruitingRequest<{
    uploadUrl: string;
    contentType: string;
    uploadReceipt: string;
  }>('uploads/targets', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, size: file.size }),
  });
  const response = await fetch(target.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': target.contentType },
    credentials: 'same-origin',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(t`文件上传未完成，请重试`);
  return recruitingRequest<RecruitingUpload>('uploads/complete', {
    method: 'POST',
    body: JSON.stringify({ uploadReceipt: target.uploadReceipt }),
  });
};
