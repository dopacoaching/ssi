const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

// Indexes were already created by the previous Prisma layer; don't let Mongoose
// try to re-create them (compound index names differ and would conflict).
mongoose.set('autoIndex', false);

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
    }).then((m) => m.connection);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connectDB, mongoose };
