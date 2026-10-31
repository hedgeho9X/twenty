/** Uses native cookie-session opt-in for instance subscription settings; OAuth tokens never enter this client. */
import { SESSION_COOKIE_OPT_IN_HEADER_NAME } from 'twenty-shared/constants';
import { REACT_APP_SERVER_BASE_URL } from '~/config';
import { t } from '@lingui/core/macro';

/** Reads bounded management DTOs without following redirects or storing account credentials in browser storage. */
export const subscriptionRequest = async <T>(
  path = '',
  options: RequestInit = {},
): Promise<T> => {
  const response = await fetch(
    `${REACT_APP_SERVER_BASE_URL.replace(/\/$/, '')}/chatgpt-subscriptions${path}`,
    {
      ...options,
      credentials: 'include',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        [SESSION_COOKIE_OPT_IN_HEADER_NAME]: '1',
        ...options.headers,
      },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(45000)])
        : AbortSignal.timeout(45000),
    },
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      typeof body.message === 'string'
        ? body.message
        : t`订阅连接操作未完成，请检查本人管理员会话`,
    );
  return body as T;
};
