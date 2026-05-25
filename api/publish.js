// POST /api/publish
//
// Generates state.json from the current MongoDB state (config + triage),
// commits it to the science-notes GitHub repo, which triggers a Vercel
// redeploy of the public site at notes.scienceaccountability.org.
//
// Body shape:
//   {
//     items: [{ link, title, author, sourceName, date, image, excerpt }, ...]
//   }
//
// The reader must supply the RSS item data because the API doesn't fetch RSS
// itself — the reader already has parsed items in memory and knows which ones
// are in hero/selected/recent slots. The API combines those item details with
// MongoDB-stored triage (tags, brief, kicker) to produce the final state.json.

import { getDb, COLLECTIONS, CONFIG_DOC_ID } from "./_lib/mongo.js";
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
  if (!items.length) {
    res.status(400).json({ error: "items array is required (RSS item details)" });
    return;
  }

  // Index items by link for fast lookup
  const itemsByUrl = {};
  for (const it of items) {
    if (it && it.link) itemsByUrl[it.link] = it;
  }

  try {
    const db = await getDb();

    const configDoc = await db.collection(COLLECTIONS.CONFIG).findOne({ _id: CONFIG_DOC_ID });
    if (!configDoc?.frontpage) {
      res.status(400).json({ error: "No frontpage configured yet" });
      return;
    }
    const fp = configDoc.frontpage;

    // Fetch triage for all URLs we care about: hero, selected, plus all starred
    // (the starred set is the source for the auto-fill recent list).
    const interestingUrls = new Set();
    if (fp.heroUrl) interestingUrls.add(fp.heroUrl);
    for (const u of fp.selectedUrls || []) {
      if (u) interestingUrls.add(u);
    }

    const allStarred = await db.collection(COLLECTIONS.TRIAGE)
      .find({ starred: true })
      .toArray();
    const starredByUrl = {};
    for (const t of allStarred) {
      starredByUrl[t._id] = t;
      interestingUrls.add(t._id);
    }

    // Helper: build a published-post object from URL + triage + RSS item data
    function serialize(url) {
      if (!url) return null;
      const item = itemsByUrl[url];
      if (!item) return null;
      const t = starredByUrl[url] || {};
      return {
        title: item.title,
        link: url,
        author: item.author || "",
        sourceName: item.sourceName,
        date: item.date || null,
        image: item.image || "",
        excerpt: item.excerpt || "",
        brief: t.brief || "",
        kicker: t.kicker || (Array.isArray(t.tags) && t.tags[0] ? t.tags[0].toUpperCase() : ""),
        tags: Array.isArray(t.tags) ? t.tags : [],
      };
    }

    const hero = serialize(fp.heroUrl);
    const selected = (fp.selectedUrls || [])
      .map(serialize)
      .filter(Boolean);

    // Recent: starred URLs by date desc, excluding hero & selected, capped
    const exclude = new Set([fp.heroUrl, ...(fp.selectedUrls || [])].filter(Boolean));
    const recent = allStarred
      .filter(t => !exclude.has(t._id) && itemsByUrl[t._id])
      .map(t => ({ url: t._id, date: itemsByUrl[t._id].date, t }))
      .sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db_ = b.date ? new Date(b.date).getTime() : 0;
        return db_ - da;
      })
      .slice(0, fp.recentCount || 6)
      .map(({ url }) => serialize(url))
      .filter(Boolean);

    const out = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: auth.editor,
      tagline: fp.tagline || "",
      hero,
      selected,
      recent,
      feeds: configDoc.feeds || { scientists: [], writers: [] },
    };

    const stateJson = JSON.stringify(out, null, 2);

    // Commit to GitHub
    const commit = await commitFile({
      path: "state.json",
      content: stateJson,
      message: `Publish: ${fp.tagline ? fp.tagline.slice(0, 60) : "weekly update"} (by ${auth.editor})`,
      editor: auth.editor,
    });

    db.collection(COLLECTIONS.ACTIVITY).insertOne({
      type: "publish",
      editor: auth.editor,
      at: new Date(),
      commitSha: commit.commitSha,
      slotCounts: {
        hero: hero ? 1 : 0,
        selected: selected.length,
        recent: recent.length,
      },
    }).catch(() => {});

    res.status(200).json({
      ok: true,
      commit,
      slotCounts: {
        hero: hero ? 1 : 0,
        selected: selected.length,
        recent: recent.length,
      },
    });
  } catch (err) {
    console.error("POST /api/publish error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
}

export default withCors(handler);
