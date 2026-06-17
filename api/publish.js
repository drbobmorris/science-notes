// POST /api/publish
//
// Generates state.json from the current MongoDB state (config + triage),
// commits it to the science-notes GitHub repo, which triggers a Vercel
// redeploy of the public site at notes.scienceaccountability.org.
//
// Since the homepage now reads live from /api/homepage, this committed
// state.json serves as a versioned snapshot and as the homepage's fallback
// when the live endpoint/DB is unavailable. The actual front-page assembly is
// shared with the live endpoint via _lib/frontpage.js so the two can't diverge.
//
// Body shape:
//   {
//     items: [{ link, title, author, sourceName, date, image, excerpt }, ...]
//   }
//
// The reader may supply live RSS item data so the freshest feed metadata is
// preferred; any posts not in the feed window fall back to the metadata stored
// on their triage documents.

import { getDb, COLLECTIONS } from "./_lib/mongo.js";
import { buildFrontpageData } from "./_lib/frontpage.js";
import { checkAuth, withCors } from "./_lib/auth.js";
import { commitFile } from "./_lib/github.js";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = checkAuth(req, res, true);
  if (!auth.ok) return;

  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];

  // Index any supplied live RSS items by link for fast lookup. Optional now —
  // the builder falls back to stored triage metadata when an item is absent.
  const itemsByUrl = {};
  for (const it of items) {
    if (it && it.link) itemsByUrl[it.link] = it;
  }

  try {
    const db = await getDb();

    const built = await buildFrontpageData(db, itemsByUrl);
    if (!built.ok) {
      res.status(400).json({ error: built.error });
      return;
    }

    const out = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: auth.editor,
      ...built.data,
    };

    const stateJson = JSON.stringify(out, null, 2);

    // Commit to GitHub (triggers a Vercel redeploy with the fresh snapshot).
    const commit = await commitFile({
      path: "state.json",
      content: stateJson,
      message: `Publish: ${
        out.tagline ? out.tagline.slice(0, 60) : "weekly update"
      } (by ${auth.editor})`,
      editor: auth.editor,
    });

    const slotCounts = {
      hero: out.featured ? 1 : 0,
      selected: out.selected.length,
      recent: out.recent.length,
    };

    db.collection(COLLECTIONS.ACTIVITY)
      .insertOne({
        type: "publish",
        editor: auth.editor,
        at: new Date(),
        commitSha: commit.commitSha,
        slotCounts,
      })
      .catch(() => {});

    res.status(200).json({ ok: true, commit, slotCounts });
  } catch (err) {
    console.error("POST /api/publish error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
}

export default withCors(handler);
