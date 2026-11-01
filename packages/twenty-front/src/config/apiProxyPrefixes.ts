/** Routes native and fork-specific API roots to the backend while preserving similarly named SPA routes. */
import { ApiPath } from 'twenty-shared/types';

export const API_PROXY_PATHS = [
  ...Object.values(ApiPath),
  'recruiting-portal',
  'chatgpt-subscriptions',
] as const;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildApiProxyMatcher = (
  apiPath: (typeof API_PROXY_PATHS)[number],
) => `^/${escapeRegExp(apiPath)}($|[/?])`;
