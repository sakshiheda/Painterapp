'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const db = require('./db');
const { apiKeyAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errors');
const capturesRouter = require('./routes/captures');
const markerRouter = require('./routes/marker');

function buildApp() {
  db.init(config.dataDir);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  const corsOptions = config.corsOrigins.includes('*')
    ? { origin: true }
    : { origin: config.corsOrigins };
  app.use(cors(corsOptions));

  if (config.env !== 'test') app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Public health endpoint — used by load balancers, no auth required
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()), env: config.env });
  });

  app.get('/', (_req, res) => {
    res.json({
      name: 'PainterApp Measurement API',
      version: '1.0.0',
      docs: '/api/v1',
    });
  });

  // Everything below /api requires auth + is rate limited
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api', limiter, apiKeyAuth);
  app.use('/api/v1', capturesRouter);
  app.use('/api/v1', markerRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

if (require.main === module) {
  const app = buildApp();
  // Bind to 0.0.0.0 (all IPv4 interfaces) — explicit dual-stack so the
  // server is reachable from other hosts on the LAN, not just IPv6
  // loopback. Override with PAINTERAPP_HOST if you need to scope it.
  const host = process.env.PAINTERAPP_HOST || '0.0.0.0';
  const server = app.listen(config.port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`[painterapp-api] listening on http://${host}:${config.port} (${config.env})`);
  });

  const shutdown = (signal) => {
    // eslint-disable-next-line no-console
    console.log(`\n[painterapp-api] received ${signal}, closing...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { buildApp };
