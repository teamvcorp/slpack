import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI environment variable is not set');

// Serverless-safe singleton: reuse across warm invocations
// maxPoolSize: 5 — each serverless instance has its own pool; small is correct
// minPoolSize: 0 — don't hold idle connections between invocations
// maxIdleTimeMS: 30s — release unused connections quickly
const options = {
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 30_000,
  connectTimeoutMS: 10_000,
  serverSelectionTimeoutMS: 10_000,
};

/**
 * Pass this to every WRITE (insertOne / updateOne / updateMany).
 *
 * WHY (bug fix, 2026-09-09): the driver's default is `ignoreUndefined: false`,
 * which serialises a JavaScript `undefined` as BSON **null**. Our write paths
 * deliberately choose absence over null — e.g. `carrierCostUSD ?? undefined` in
 * app/api/shipping/submit/route.ts when a label call fails — and the driver was
 * silently overruling them. Read paths test for absence (`x !== undefined`), so
 * the stored null slipped past the guard and `null.toFixed()` took down the
 * whole Reports page. Storing the field as ABSENT is what every reader assumes.
 *
 * DO NOT set this on the MongoClient instead. The option applies to query
 * FILTERS as well as documents: with it on client-wide, a bug that passed an
 * undefined id would turn `findOne({ id: undefined })` into `findOne({})` and
 * hand back an arbitrary customer's shipment. Scoping it to writes gets the
 * correctness fix with none of that exposure — keep it here, per operation.
 */
export const IGNORE_UNDEFINED = { ignoreUndefined: true } as const;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
}

let client: MongoClient;

if (process.env.NODE_ENV === 'development') {
  // In dev, reuse across HMR reloads via global
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(uri, options);
  }
  client = global._mongoClient;
} else {
  client = new MongoClient(uri, options);
}

export default client;
