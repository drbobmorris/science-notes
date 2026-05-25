// POST /api/frontpage
//
// Updates the frontpage configuration: which post is hero, which are in selected,
// the tagline that appears on the published front page, and how many recent posts
// auto-fill the sidebar.
//
// Body shape:
//   {
//     tagline?: string,
//     heroUrl?: string,
//     selectedUrls?: string[],
//     recentCount?: number
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

  // Build a frontpage object with whatever fields the client sent
  const fpUpdate = {};
  if (typeof body.tagline === "string") fpUpdate["frontpage.tagline"] = body.tagline;
  if (typeof body.heroUrl === "string") fpUpdate["frontpage.heroUrl"] = body.heroUrl;
  if (Array.isArray(body.selectedUrls)) {
    fpUpdate["frontpage.selectedUrls"] = body.selectedUrls
      .map(u => String(u || "").trim())
      .slice(0, 10); // generous cap; current UI uses 3
  }
  if (typeof body.recentCount === "number" && body.recentCount > 0 && body.recentCount <= 20) {
    fpUpdate["frontpage.recentCount"] = body.recentCount;
  }

  if (!Object.keys(fpUpdate).length) {
    res.status(400).json({ error: "No frontpage fields provided" });
    return;
  }

  fpUpdate.updatedAt = new Date();
  fpUpdate.editedBy = auth.editor;

  try {
    const db = await getDb();
    await db.collection(COLLECTIONS.CONFIG).updateOne(
      { _id: CONFIG_DOC_ID },
      {
        $set: fpUpdate,
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    db.collection(COLLECTIONS.ACTIVITY).insertOne({
      type: "frontpage",
      editor: auth.editor,
      at: new Date(),
      fields: Object.keys(fpUpdate).filter(k => k.startsWith("frontpage.")),
    }).catch(() => {});

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("POST /api/frontpage error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
}

export default withCors(handler);
