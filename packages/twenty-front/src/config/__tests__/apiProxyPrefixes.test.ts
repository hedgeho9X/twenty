import { ApiPath, AppPath } from 'twenty-shared/types';

import {
  API_PROXY_PATHS,
  buildApiProxyMatcher,
} from '~/config/apiProxyPrefixes';

const matchers = API_PROXY_PATHS.map(
  (apiPath) => new RegExp(buildApiProxyMatcher(apiPath)),
);

const isProxiedPath = (path: string) =>
  matchers.some((matcher) => matcher.test(path));

describe('apiProxyPrefixes', () => {
  it.each([
    'recruiting-portal',
    'chatgpt-subscriptions',
    'recruiting-job-pages',
  ])(
    'should proxy the standalone fork API root %s and its operations',
    (apiPath) => {
      expect(isProxiedPath(`/${apiPath}`)).toBe(true);
      expect(isProxiedPath(`/${apiPath}/nested-operation`)).toBe(true);
      expect(isProxiedPath(`/${apiPath}?query=value`)).toBe(true);
    },
  );

  it.each([
    '/candidate-portal',
    '/job-introductions',
    '/recruiting-job-pages-other',
    '/recruiting-workspace',
    '/recruiting-portal-other',
    '/chatgpt-subscriptions-other',
  ])('should preserve frontend and unrelated routes %s', (path) => {
    expect(isProxiedPath(path)).toBe(false);
  });

  it.each(Object.values(ApiPath))('should proxy the API path %s', (apiPath) => {
    expect(isProxiedPath(`/${apiPath}`)).toBe(true);
    expect(isProxiedPath(`/${apiPath}/nested-path`)).toBe(true);
    expect(isProxiedPath(`/${apiPath}?query=value`)).toBe(true);
  });

  it.each(Object.values(AppPath))(
    'should not proxy the SPA route %s',
    (appPath) => {
      expect(isProxiedPath(appPath)).toBe(false);
    },
  );

  const viteDevServerPaths = [
    '/',
    '/index.html',
    '/src/main.tsx',
    '/@vite/client',
    '/node_modules/.vite/deps/react.js',
  ];

  it.each(viteDevServerPaths)(
    'should not proxy the vite dev server path %s',
    (viteDevServerPath) => {
      expect(isProxiedPath(viteDevServerPath)).toBe(false);
    },
  );
});
