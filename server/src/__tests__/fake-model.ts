import { createServer, type Server } from 'node:http';

// A real OpenAI-compatible endpoint on an ephemeral port, for the jobs that ask the admin's model
// in words, so what is proven is the request that reaches the wire, not a stub's arguments.

/** What reaches the endpoint, as far as a test reads it. */
export interface ChatRequest {
  model: string;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  messages: Array<{ role: string; content: unknown }>;
}

/** What the fake endpoint answers: the reply's text, and why it stopped, `stop` unless said. */
export interface Answer {
  content: string;
  finishReason?: string;
}

/**
 * Starts the endpoint.
 *
 * @param answer - What to reply to each request: an answer, or a status to fail with. A promise
 *   holds the reply until it settles, so a test can change the database while the model "thinks".
 * @returns Its base URL, every request body it received, and a way to close it.
 */
export async function fakeEndpoint(
  answer: (body: ChatRequest) => Answer | { status: number } | Promise<Answer | { status: number }>,
) {
  const bodies: ChatRequest[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', async () => {
      const body = JSON.parse(raw) as ChatRequest;
      bodies.push(body);
      const reply = await answer(body);
      if ('status' in reply) {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'the model is not loaded' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: reply.content },
              finish_reason: reply.finishReason ?? 'stop',
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    bodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
