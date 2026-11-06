import { STATUS_CODES } from 'node:http';

// Fastify-wide guards, registered once on the root instance (before the routes).
//
// 1. A request without a body (POST/PUT/PATCH with no payload) gets `{}`, so `const { a } = req.body` answers with
//    our own 400 instead of a TypeError and a 500.
// 2. Errors with a 4xx status (our own `statusCode: 404/403`, Fastify's validation and body-parsing errors) keep
//    the default `{ statusCode, error, message }` answer. Everything else is a server fault: it is logged in full
//    and the client gets a fixed text, so database messages (table, constraint, query) never leave the server.
export function registerHardening(app) {
  app.addHook('preValidation', async (req) => {
    if (req.body === undefined && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) req.body = {};
  });

  app.setErrorHandler((error, req, reply) => {
    const status = Number(error.statusCode);
    if (status >= 400 && status < 500) {
      return reply.status(status).send({ statusCode: status, error: STATUS_CODES[status] || 'Error', message: error.message });
    }
    req.log.error({ err: error }, 'unhandled route error');
    return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Внутренняя ошибка сервера' });
  });
}
