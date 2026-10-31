/** Calls the shared recruiting boundary using the official cookie session, with no frontend API keys. */
import { SESSION_COOKIE_OPT_IN_HEADER_NAME } from 'twenty-shared/constants';
import { REACT_APP_SERVER_BASE_URL } from '~/config';
import { type RecruitingUpload } from '@/recruiting/types/RecruitingUpload';
import { t } from '@lingui/core/macro';

/** Preserves server errors without exposing stack traces or transport headers. */
export const recruitingRequest = async <T>(
  path: string,
  options: RequestInit = {},
): Promise<T> => {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  headers.set(SESSION_COOKIE_OPT_IN_HEADER_NAME, '1');
  const response = await fetch(
    `${REACT_APP_SERVER_BASE_URL.replace(/\/$/, '')}/recruiting/${path}`,
    {
      ...options,
      credentials: 'include',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
      headers,
    },
  );
  const body: unknown = await response.json();
  if (!response.ok) {
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
  return body as T;
};

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
