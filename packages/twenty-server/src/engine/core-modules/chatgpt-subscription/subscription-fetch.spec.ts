/** Tests subscription protocol adaptation with synthetic credentials and SSE payloads. */
import { createSubscriptionFetch } from './subscription-fetch';

const completed = {
  type: 'response.completed',
  response: {
    id: 'response-test',
    status: 'completed',
    output: [],
    usage: { input_tokens: 1, output_tokens: 1 },
  },
};

/** Creates a real streamed Response, optionally dividing UTF-8 data across arbitrary chunks. */
const eventResponse = (events: object[], chunkSize = 4096) => {
  const bytes = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += chunkSize)
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
};

describe('subscription Responses adapter', () => {
  const credential = {
    accessToken: 'synthetic-subscription-token',
    accountId: 'synthetic-account',
    protocol: 'codex' as const,
  };

  it('adapts Codex parameters and returns completed JSON for generateText', async () => {
    const upstream = jest.fn(async () => eventResponse([completed]));
    const adapted = createSubscriptionFetch({
      loadCredential: async () => credential,
      upstreamFetch: upstream,
    });
    const response = await adapted('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer sdk-placeholder' },
      body: JSON.stringify({
        model: 'test-model',
        stream: false,
        store: true,
        max_output_tokens: 100,
        temperature: 1,
        input: [{ role: 'system', content: 'policy' }],
      }),
    });
    expect(await response.json()).toEqual(completed.response);
    const [url, options] = upstream.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
    const body = JSON.parse(String(options.body));
    expect(body).toMatchObject({
      stream: true,
      store: false,
      input: [{ role: 'developer' }],
    });
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(new Headers(options.headers).get('authorization')).toBe(
      'Bearer synthetic-subscription-token',
    );
  });

  it('keeps SIWC credentials on the public Responses endpoint', async () => {
    const upstream = jest.fn(async () => eventResponse([completed]));
    const adapted = createSubscriptionFetch({
      loadCredential: async () => ({ ...credential, protocol: 'siwc' }),
      upstreamFetch: upstream,
    });
    await adapted('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ max_output_tokens: 100 }),
    });
    const [url, options] = upstream.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(String(options.body)).max_output_tokens).toBe(100);
    expect(new Headers(options.headers).has('ChatGPT-Account-Id')).toBe(false);
  });

  it('does not load credentials for an unsupported destination', async () => {
    const loader = jest.fn(async () => credential);
    const adapted = createSubscriptionFetch({ loadCredential: loader });
    await expect(
      adapted('https://example.invalid/v1/responses', { method: 'POST' }),
    ).rejects.toThrow('Unsupported subscription API route');
    expect(loader).not.toHaveBeenCalled();
  });

  it('does not accept a stream that only emitted partial text', async () => {
    const adapted = createSubscriptionFetch({
      loadCredential: async () => credential,
      upstreamFetch: async () =>
        eventResponse([
          { type: 'response.output_text.delta', delta: 'partial' },
        ]),
    });
    await expect(
      adapted('https://api.openai.com/v1/responses', {
        method: 'POST',
        body: '{}',
      }),
    ).rejects.toThrow('response.completed');
  });

  it('treats a failed terminal event as failure', async () => {
    const adapted = createSubscriptionFetch({
      loadCredential: async () => credential,
      upstreamFetch: async () =>
        eventResponse([
          { type: 'response.failed', response: { status: 'failed' } },
        ]),
    });
    await expect(
      adapted('https://api.openai.com/v1/responses', {
        method: 'POST',
        body: '{}',
      }),
    ).rejects.toThrow('did not complete successfully');
  });

  it('preserves UTF-8 SSE split across small network chunks', async () => {
    const event = {
      ...completed,
      response: {
        ...completed.response,
        output: [{ content: [{ text: '中文资料' }] }],
      },
    };
    const adapted = createSubscriptionFetch({
      loadCredential: async () => credential,
      upstreamFetch: async () => eventResponse([event], 3),
    });
    const response = await adapted('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: '{}',
    });
    expect(await response.json()).toEqual(event.response);
  });

  it('rejects interrupted streaming output instead of reporting a normal end', async () => {
    const adapted = createSubscriptionFetch({
      loadCredential: async () => credential,
      upstreamFetch: async () =>
        eventResponse([
          { type: 'response.output_text.delta', delta: 'partial' },
        ]),
    });
    const response = await adapted('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: '{"stream":true}',
    });
    await expect(response.text()).rejects.toThrow('terminal event');
  });

  it.each(['error', 'response.failed', 'response.incomplete'])(
    'rejects streaming %s without forwarding provider error payloads',
    async (type) => {
      const adapted = createSubscriptionFetch({
        loadCredential: async () => credential,
        upstreamFetch: async () =>
          eventResponse(
            [
              {
                type,
                error: { message: 'synthetic-private-error' },
                response: { status: 'failed' },
              },
            ],
            3,
          ),
      });
      const response = await adapted('https://api.openai.com/v1/responses', {
        method: 'POST',
        body: '{"stream":true}',
      });
      await expect(response.text()).rejects.toThrow(
        type === 'response.incomplete'
          ? 'response is incomplete'
          : 'subscription request failed',
      );
    },
  );

  it('loads fresh credentials per request', async () => {
    let revision = 0;
    const upstream = jest.fn(async () => eventResponse([completed]));
    const adapted = createSubscriptionFetch({
      loadCredential: async () => ({
        ...credential,
        accessToken: `token-${++revision}`,
      }),
      upstreamFetch: upstream,
    });
    await adapted('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: '{}',
    });
    await adapted('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: '{}',
    });
    const headers = upstream.mock.calls.map((call) =>
      new Headers((call as unknown as [string, RequestInit])[1].headers).get(
        'authorization',
      ),
    );
    expect(headers).toEqual(['Bearer token-1', 'Bearer token-2']);
  });
});
