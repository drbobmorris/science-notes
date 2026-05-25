// GET /api/state
//
// Returns the full reader state needed at startup:
//   { feeds, triage, frontpage, prefs }
//
// Reads are public by default (anyone can see what's in the reader's state).
// Set EDITOR_ONLY_READ=true in env vars if you want even reads to require the password.

import { getDb, COLLECTIONS, CONFIG_DOC_ID } from "./_lib/mongo.js";
import { checkAuth, withCors } from "./_lib/auth.js";

async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = checkAuth(req, res, false); // reads don't require auth by default
  if (!auth.ok) return;

  try {
    const db = await getDb();

    // Config doc holds feeds, frontpage config, prefs. One document, well-known ID.
    const configDoc = await db.collection(COLLECTIONS.CONFIG).findOne({ _id: CONFIG_DOC_ID });

    // Triage docs are one per URL. Return them as a URL-keyed object to match the
    // shape the reader already expects from localStorage.
    const triageDocs = await db.collection(COLLECTIONS.TRIAGE).find({}).toArray();
    const triage = {};
    for (const doc of triageDocs) {
      // _id is the URL. Strip it from the payload and use as key.
      const { _id, ...rest } = doc;
      triage[_id] = rest;
    }

    res.status(200).json({
      feeds: configDoc?.feeds || { scientists: [], writers: [] },
      frontpage: configDoc?.frontpage || {
        tagline: "",
        heroUrl: "",
        selectedUrls: [],
        recentCount: 5,
      },
      prefs: configDoc?.prefs || {},
      triage,
      meta: {
        configUpdatedAt: configDoc?.updatedAt || null,
        configEditedBy: configDoc?.editedBy || null,
        triageCount: triageDocs.length,
      },
    });
  } catch (err) {
    console.error("GET /api/state error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
}

export default withCors(handler);
