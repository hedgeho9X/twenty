/** Adapts subscription Responses in-process; credentials never become SDK API keys. */
import tls from 'node:tls';

import { SocksClient } from 'socks';
import { Agent } from 'undici';
import { isPlainObject } from 'twenty-shared/utils';

/** Credentials are loaded by the connection manager for every request to avoid stale tokens. */
export type SubscriptionCredential = {
  accessToken: string;
  accountId?: string;
  protocol: 'codex' | 'siwc';
};

/** Injected transports and credential loaders keep protocol tests independent of real accounts. */
export type SubscriptionFetchOptions = {
  loadCredential: () => Promise<SubscriptionCredential>;
  upstreamFetch?: typeof fetch;
};

const proxyAgents = new Map<string, Agent>();

/** Uses the configured SOCKS transport without changing global fetch or machine proxy settings. */
export const createSubscriptionTransport = (
  proxyUrl?: string,
): typeof fetch => {
  if (!proxyUrl) return fetch;
  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    const proxy = new URL(proxyUrl);
    if (!['socks5:', 'socks5h:'].includes(proxy.protocol)) {
      throw new Error('Subscription transport requires a SOCKS5 proxy URL');
    }
    agent = new Agent({
      connect: (options, callback) => {
        let finished = false;
        const complete: typeof callback = (...arguments_) => {
          if (finished) return;
          finished = true;
          callback(...arguments_);
        };
        void SocksClient.createConnection({
          proxy: {
            host: proxy.hostname,
            port: Number(proxy.port || 1080),
            type: 5,
            userId: decodeURIComponent(proxy.username),
            password: decodeURIComponent(proxy.password),
          },
          command: 'connect',
          destination: {
            host: String(options.hostname),
            port: Number(options.port || 443),
          },
          timeout: 30_000,
        }).then(
          ({ socket }) => {
            const secure = tls.connect({
              socket,
              servername: String(options.hostname),
            });
            secure.once('secureConnect', () => complete(null, secure));
            secure.once('error', (error) => complete(error, null));
          },
          (error: Error) => complete(error, null),
        );
      },
    });
    proxyAgents.set(proxyUrl, agent);
  }
  const dispatcher = agent;
  return (input, init) =>
    fetch(input, { ...init, dispatcher } as RequestInit & {
      dispatcher: Agent;
    });
};

/** Releases idle connections when the owning application is shutting down. */
export const closeSubscriptionTransports = async (): Promise<void> => {
  await Promise.all([...proxyAgents.values()].map((agent) => agent.close()));
  proxyAgents.clear();
};

/** Decodes complete SSE frames; partial network chunks remain buffered by the caller. */
const readFrame = (frame: string): Record<string, unknown> | undefined => {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return undefined;
  const parsed: unknown = JSON.parse(data);
  if (!isPlainObject(parsed)) return undefined;
  return parsed as Record<string, unknown>;
};

/** Builds non-streaming Responses JSON only from an explicit successful terminal event. */
const completedResponse = async (response: Response): Promise<Response> => {
  if (!response.body)
    throw new Error('Subscription response stream is missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let completed: Record<string, unknown> | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      const frames = buffered.split(/\r?\n\r?\n/);
      buffered = done ? '' : (frames.pop() ?? '');
      for (const frame of frames) {
        const event = readFrame(frame);
        if (
          event?.type === 'response.failed' ||
          event?.type === 'response.incomplete' ||
          event?.type === 'error'
        ) {
          throw new Error(
            'Subscription inference did not complete successfully',
          );
        }
        if (
          event?.type === 'response.completed' &&
          event.response &&
          typeof event.response === 'object'
        ) {
          completed = event.response as Record<string, unknown>;
        }
      }
      if (done) break;
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!completed || completed.status !== 'completed')
    throw new Error('Subscription stream ended before response.completed');
  return Response.json(completed, { status: 200 });
};

/** Keeps streaming output incremental and refuses a dropped stream without a terminal event. */
const guardedStream = (response: Response): Response => {
  if (!response.body)
    throw new Error('Subscription response stream is missing');
  const decoder = new TextDecoder();
  let buffered = '';
  let terminal = false;
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true });
        const frames = buffered.split(/\r?\n\r?\n/);
        buffered = frames.pop() ?? '';
        for (const frame of frames) {
          const event = readFrame(frame);
          if (
            ['error', 'response.failed', 'response.incomplete'].includes(
              String(event?.type),
            )
          ) {
            controller.error(
              new Error(
                event?.type === 'response.incomplete'
                  ? 'ChatGPT subscription response is incomplete'
                  : 'ChatGPT subscription request failed',
              ),
            );
            return;
          }
          if (
            [
              'response.completed',
              'response.failed',
              'response.incomplete',
              'error',
            ].includes(String(event?.type))
          )
            terminal = true;
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (!terminal)
          controller.error(
            new Error('Subscription stream ended before a terminal event'),
          );
      },
    }),
  );
  return new Response(stream, {
    status: response.status,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
};

/** Translates only Responses requests; Codex and official SIWC credentials retain separate routes. */
export const createSubscriptionFetch =
  ({
    loadCredential,
    upstreamFetch = fetch,
  }: SubscriptionFetchOptions): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      url.origin !== 'https://api.openai.com' ||
      url.pathname !== '/v1/responses' ||
      request.method !== 'POST'
    ) {
      throw new Error('Unsupported subscription API route');
    }
    const body = (await request.json()) as Record<string, unknown>;
    const wantsStream = body.stream === true;
    const credential = await loadCredential();
    body.store = false;
    body.stream = true;
    if (credential.protocol === 'codex') {
      for (const key of [
        'max_output_tokens',
        'max_completion_tokens',
        'temperature',
        'top_p',
        'presence_penalty',
        'frequency_penalty',
      ])
        delete body[key];
      body.instructions ??= '';
      if (Array.isArray(body.input))
        body.input = body.input.map((item: Record<string, unknown>) =>
          item.role === 'system' ? { ...item, role: 'developer' } : item,
        );
    }
    const headers = new Headers({
      authorization: `Bearer ${credential.accessToken}`,
      'content-type': 'application/json',
    });
    if (credential.protocol === 'codex') {
      if (credential.accountId)
        headers.set('ChatGPT-Account-Id', credential.accountId);
      headers.set('originator', 'codex_cli_rs');
      headers.set('User-Agent', 'codex_cli_rs/0.144.1');
    }
    const response = await upstreamFetch(
      credential.protocol === 'codex'
        ? 'https://chatgpt.com/backend-api/codex/responses'
        : 'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: request.signal,
        redirect: 'error',
      },
    );
    if (!response.ok) return response;
    return wantsStream ? guardedStream(response) : completedResponse(response);
  };
