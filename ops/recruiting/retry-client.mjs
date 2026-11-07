/** Retries transient transport failures only when repeating the request cannot create a second business action. */
export const withRecruitingRetry = (client, { attempts = 12, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) => {
  const retry = async (run, safe) => {
    for (let attempt = 0; ; attempt++) {
      try { return await run(); }
      catch (error) {
        const transient = (error.status === 500 && attempt < 2) || [429, 502, 503, 504].includes(error.status) ||
          (error.status === 404 && error.code === 'INVALID_JSON') ||
          error instanceof TypeError || error.name === 'TimeoutError';
        if (!safe || !transient || attempt >= attempts) throw error;
        await pause(Math.min(30000, 1000 * 2 ** attempt));
      }
    }
  };
  return {
    ...client,
    request: (path, options) => retry(() => client.request(path, options), !options?.method || options.method === 'GET'),
    post: (path, body) => retry(() => client.post(path, body), Boolean(body?.idempotencyKey || (path.endsWith('/reparse') && body?.batchKey))),
  };
};
