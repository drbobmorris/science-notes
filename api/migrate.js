// POST /api/migrate
//
// One-time import endpoint. Accepts a SAI Reader backup JSON in the request body,
// writes its feeds + triage + frontpage into MongoDB. Used to seed the database
// from your existing localStorage backup.
//
// Safe to run multiple times — each run replaces the config doc and upserts
// each triage record. Existing triage records for URLs not in the backup are
// preserved (no destructive deletes).
//
// Body: the full contents of a sai-reader-backup-*.json file.
// Header: x-sai-password required.

import { getDb, COLLECTIONS, CONFIG_DOC_ID } from "./_lib/mongo.js";
import { checkAuth, withCors } from "./_lib/auth.js";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = checkAuth(req, res, true);
  if (!auth.ok) return;

  const data = req.body || {};
  if (data.kind !== "sai-reader-backup") {
    res.status(400).json({ error: "Body is not a SAI Reader backup file" });
    return;
  }

  try {
    const db = await getDb();

    // --- Write config (feeds, frontpage, prefs) ---
    const configPatch = {
      updatedAt: new Date(),
      editedBy: auth.editor,
      migratedFrom: data.generatedAt || null,
    };
    if (data.feeds?.scientists && data.feeds?.writers) {
      configPatch.feeds = {
        scientists: data.feeds.scientists.map(f => ({
          name: String(f.name || "").trim(),
          author: String(f.author || "").trim(),
          url: String(f.url || "").trim(),
        })).filter(f => f.name && f.url),
        writers: data.feeds.writers.map(f => ({
          name: String(f.name || "").trim(),
          author: String(f.author || "").trim(),
          url: String(f.url || "").trim(),
        })).filter(f => f.name && f.url),
      };
    }
    if (data.frontpage) {
      configPatch.frontpage = {
        tagline: data.frontpage.tagline || "",
        heroUrl: data.frontpage.heroUrl || "",
        selectedUrls: Array.isArray(data.frontpage.selectedUrls) ? data.frontpage.selectedUrls : [],
        recentCount: data.frontpage.recentCount || 5,
      };
    }
    if (data.prefs) {
      configPatch.prefs = data.prefs;
    }

    await db.collection(COLLECTIONS.CONFIG).updateOne(
      { _id: CONFIG_DOC_ID },
      {
        $set: configPatch,
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    // --- Write triage records ---
    let triageWritten = 0;
    if (data.triage && typeof data.triage === "object") {
      const ops = [];
      for (const [url, record] of Object.entries(data.triage)) {
        if (!url) continue;
        const doc = {
          tags: Array.isArray(record.tags) ? record.tags : [],
          starred: !!record.starred,
          archived: !!record.archived,
          brief: record.brief || "",
          kicker: record.kicker || "",
          updatedAt: new Date(),
          updatedBy: auth.editor,
          migratedFrom: data.generatedAt || null,
        };
        ops.push({
          updateOne: {
            filter: { _id: url },
            update: {
              $set: doc,
              $setOnInsert: {
                createdAt: new Date(),
                createdBy: auth.editor,
              },
            },
            upsert: true,
          },
        });
      }
      if (ops.length) {
        const result = await db.collection(COLLECTIONS.TRIAGE).bulkWrite(ops, { ordered: false });
        triageWritten = (result.upsertedCount || 0) + (result.modifiedCount || 0);
      }
    }

    db.collection(COLLECTIONS.ACTIVITY).insertOne({
      type: "migrate",
      editor: auth.editor,
      at: new Date(),
      source: data.generatedAt || "unknown",
      triageWritten,
      feedsCount: (configPatch.feeds?.scientists?.length || 0) + (configPatch.feeds?.writers?.length || 0),
    }).catch(() => {});

    res.status(200).json({
      ok: true,
      triageWritten,
      feedsImported: {
        scientists: configPatch.feeds?.scientists?.length || 0,
        writers: configPatch.feeds?.writers?.length || 0,
      },
      frontpageImported: !!configPatch.frontpage,
    });
  } catch (err) {
    console.error("POST /api/migrate error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
}

export default withCors(handler);
