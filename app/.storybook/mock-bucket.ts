import type { Plugin } from 'vite';

/**
 * A bucket that answers, so the upload panel's whole path is a story.
 *
 * `putFile` does a real `XMLHttpRequest` PUT to whatever presigned URL the server handed back,
 * and that is not a detail a mock can paper over: it is the only place progress is reported and
 * the only place a storage failure becomes a message. Mocking the GraphQL either side of it
 * leaves exactly the interesting bit untested.
 *
 * So the harness serves the bucket instead. A story picks its outcome by which path it puts to:
 *
 * - `MOCK_BUCKET_OK` — 204, the upload lands
 * - `MOCK_BUCKET_DENIED` — 403, what an expired signature looks like from the browser
 *
 * Storybook only. The real client never sees these; they exist because the alternative is a
 * component whose failure branch nobody has ever watched render.
 */
export const MOCK_BUCKET_OK = '/__mock-bucket/ok';
export const MOCK_BUCKET_DENIED = '/__mock-bucket/denied';

export function mockBucket(): Plugin {
  return {
    name: 'engrafo:mock-bucket',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'PUT' || !request.url?.startsWith('/__mock-bucket/')) return next();

        // Drained rather than ignored: leaving the body unread stalls the request, and the
        // panel sits at a progress bar that never finishes.
        request.resume();
        request.on('end', () => {
          response.statusCode = request.url?.startsWith(MOCK_BUCKET_DENIED) ? 403 : 204;
          response.end();
        });
      });
    },
  };
}
