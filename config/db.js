'use strict';

/**
 * MongoDB connection helper optimised for Vercel's serverless model.
 *
 * Serverless functions are invoked per-request and may reuse a warm container.
 * Opening a new connection on every invocation exhausts the Atlas connection
 * pool quickly, so we cache the connection promise on the Node global object
 * and reuse it across invocations within the same warm container.
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  // Fail fast with a clear message rather than a cryptic driver error later.
  // eslint-disable-next-line no-console
  console.warn('[db] MONGODB_URI is not set. Set it in your environment / Vercel project settings.');
}

// Reuse a single cached connection across hot invocations.
let cached = global.__mongoose_cache;
if (!cached) {
  cached = global.__mongoose_cache = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    };
    mongoose.set('strictQuery', true);
    cached.promise = mongoose.connect(MONGODB_URI, opts).then((m) => m);
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }
  return cached.conn;
}

module.exports = { connectDB, mongoose };
