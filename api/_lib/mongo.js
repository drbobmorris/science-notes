// Shared MongoDB connection helper for serverless functions.
// In Vercel's serverless environment, instances can be reused across invocations,
// so we cache the connection in a module-level variable. This avoids reconnecting
// on every request — a fresh connection takes ~1s, a cached one is instant.

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = "sai-reader";

if (!uri) {
  throw new Error("MONGODB_URI environment variable is not set");
}

let cachedClient = null;
let cachedDb = null;

export async function getDb() {
  if (cachedDb && cachedClient) {
    // Verify the cached connection is still alive
    try {
      await cachedClient.db("admin").command({ ping: 1 });
      return cachedDb;
    } catch (e) {
      // Connection died; fall through and reconnect
      cachedClient = null;
      cachedDb = null;
    }
  }

  const client = new MongoClient(uri, {
    // Recommended settings for serverless environments
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  const db = client.db(dbName);

  cachedClient = client;
  cachedDb = db;

  return db;
}

// Collection name constants. Centralized here so endpoints don't repeat strings.
export const COLLECTIONS = {
  CONFIG: "config",       // single document: feeds list, frontpage config, prefs
  TRIAGE: "triage",       // one document per post URL
  ACTIVITY: "activity",   // audit log of edits (who, what, when)
};

// Single document ID for the config collection — there's only ever one config doc.
export const CONFIG_DOC_ID = "main";
