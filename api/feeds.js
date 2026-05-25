// POST /api/feeds
//
// Replaces the entire feeds list (scientists + writers arrays). This is the
// simplest model — when the user adds, edits, or removes a feed in the reader,
// the reader sends the whole list. Idempotent.
//
// Body shape:
//   {
//     scientists: [{ name, author, url }, ...],
//     writers:    [{ name, author, url }, ...]
//   }

import { getDb, COLLECTIONS, CONFIG_DOC_ID } from "./_lib/mongo.js";
import { checkAuth, withCors } from "./_lib/auth.js";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = checkAuth(req, res, true);
  if (!auth.ok) return;

  const body = req.body || {};
  const scientists = Array.isArray(body.scientists) ? body.scientists : null;
  const writers = Array.isArray(body.writers) ? body.writers : null;
  if (!scientists || !writers) {
    res.status(400).json({ error: "scientists and writers arrays are required" });
    return;
  }

  // Normalize each feed entry — strip unknown fields, coerce types
  const norm = (arr) => arr.map(f => ({
    name: String(f.name || "").trim(),
    author: String(f.author || "").trim(),
    url: String(f.url || "").trim(),
  })).filter(f => f.name && f.url);

  const feeds = {
    scientists: norm(scientists),
    writers: norm(writers),
  };

  try {
    const db = await getDb();
    await db.collection(COLLECTIONS.CONFIG).updateOne(
      { _id: CONFIG_DOC_ID },
      {
        $set: {
          feeds,
          updatedAt: new Date(),
          editedBy: auth.editor,
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    db.collection(COLLECTIONS.ACTIVITY).insertOne({
      type: "feeds",
      editor: auth.editor,
      at: new Date(),
      counts: { scientists: feeds.scientists.length, writers: feeds.writers.length },
    }).catch(() => {});

    res.status(200).json({ ok: true, feeds });
  } catch (err) {
    console.error("POST /api/feeds error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
}

export default withCors(handler);
