'use strict';

require('dotenv').config();
const app = require('./app');
const { connectDB } = require('./config/db');

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await connectDB();
    // eslint-disable-next-line no-console
    console.log('[db] connected');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[db] initial connection failed (will retry on first request):', e.message);
  }
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
})();
