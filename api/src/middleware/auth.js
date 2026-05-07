'use strict';

const config = require('../config');

/**
 * Simple API key auth. Accepts either:
 *   - `x-api-key: <key>` header
 *   - `Authorization: Bearer <key>` header
 */
function apiKeyAuth(req, res, next) {
  let key = req.headers['x-api-key'];
  if (!key) {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) key = m[1];
  }
  if (!key || !config.apiKeys.includes(key)) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid API key' });
  }
  return next();
}

module.exports = { apiKeyAuth };
