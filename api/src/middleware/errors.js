'use strict';

/**
 * Centralised error handler. Hides internals in production.
 */
function notFound(req, res, _next) {
  res.status(404).json({ error: 'not_found', message: `Route ${req.method} ${req.path} not found` });
}

function errorHandler(err, req, res, _next) {
  // Multer file-size / type errors
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'payload_too_large', message: err.message });
  }
  if (err && err.status === 415) {
    return res.status(415).json({ error: 'unsupported_media_type', message: err.message });
  }

  const status = err.status || 500;
  const payload = {
    error: status >= 500 ? 'internal_error' : 'request_error',
    message: err.message || 'Unexpected error',
  };
  if (process.env.NODE_ENV !== 'production' && err.stack) payload.stack = err.stack;

  // eslint-disable-next-line no-console
  if (status >= 500) console.error('[error]', err);
  res.status(status).json(payload);
}

module.exports = { notFound, errorHandler };
