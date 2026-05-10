'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { enhancePrompt, detectProvider } = require('./enhancer');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────

// CORS — allow Chrome extension and localhost during development
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. same-origin, Postman)
      if (!origin) return cb(null, true);
      // Allow Chrome extension origins
      if (origin.startsWith('chrome-extension://')) return cb(null, true);
      // Allow explicitly configured origins
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // Allow localhost in development
      if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost/.test(origin)) {
        return cb(null, true);
      }
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);

app.use(express.json({ limit: '50kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 15) * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

app.use('/api/', limiter);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  const provider = detectProvider();
  res.json({
    service: 'Prompt Enhancer API',
    version: '1.0.0',
    provider: provider || 'none — set an API key in .env',
    status: provider ? 'ready' : 'no_api_key',
  });
});

app.post('/api/enhance', async (req, res) => {
  const { prompt, mode, settings } = req.body || {};

  // Validate input
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Request body must include a non-empty "prompt" string.' });
  }

  const trimmed = prompt.trim();
  if (trimmed.length < 3) {
    return res.status(400).json({ error: 'Prompt is too short to enhance.' });
  }
  if (trimmed.length > 8000) {
    return res.status(400).json({ error: 'Prompt exceeds the maximum length of 8000 characters.' });
  }

  try {
    const result = await enhancePrompt({ prompt: trimmed, mode, settings });
    return res.json(result);
  } catch (err) {
    // Do NOT log the full prompt content in production
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) {
      console.error('[enhance] Error:', err.message);
    } else {
      console.error('[enhance] Enhancement failed:', err.constructor.name);
    }

    // Map known error types to appropriate HTTP status codes
    if (err.status === 401 || err.message?.includes('API key')) {
      return res.status(500).json({ error: 'AI service authentication failed. Check your API key.' });
    }
    if (err.status === 429 || err.message?.includes('rate limit')) {
      return res.status(429).json({ error: 'AI service rate limit reached. Please try again shortly.' });
    }

    return res.status(500).json({
      error: isProduction
        ? 'Enhancement failed. Please try again.'
        : err.message || 'Unknown server error',
    });
  }
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const provider = detectProvider();
  console.log(`\n🚀 Prompt Enhancer API running on http://localhost:${PORT}`);
  console.log(`   Provider : ${provider || '⚠️  none — set an API key in .env'}`);
  console.log(`   Env      : ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app; // exported for testing
