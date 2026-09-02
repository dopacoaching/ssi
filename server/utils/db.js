const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

// Production already carries the indexes the retired Prisma layer created, and
// re-creating them there can conflict on differing index names — so let Mongoose
// build schema indexes everywhere EXCEPT production. This keeps `unique`
// constraints real on fresh databases (local dev, staging, tests, DR restores)
// instead of silently doing nothing. Production index changes go through a
// migration.
mongoose.set('autoIndex', process.env.NODE_ENV !== 'production');

const uri = process.env.DATABASE_URL;

// Cache the connection across serverless invocations (Vercel) so we don't open a
// new pool on every request.
const globalForMongoose = global;
let cached = globalForMongoose._mongoose;
if (!cached) cached = globalForMongoose._mongoose = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!uri) throw new Error('DATABASE_URL is not set');
  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
    }).then((m) => m.connection).catch((err) => {
      // Don't cache a rejected promise — otherwise one transient failure
      // (Atlas failover, network blip) permanently poisons a warm serverless
      // instance: every later request re-awaits the same stale rejection.
      cached.promise = null;
      throw err;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connectDB, mongoose };
