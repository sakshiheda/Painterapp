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

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

if (require.main === module) {
  const app = buildApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[painterapp-api] listening on http://localhost:${config.port} (${config.env})`);
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
