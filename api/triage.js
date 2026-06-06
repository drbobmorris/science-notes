// POST /api/triage
//
// Upserts the triage record for a single post URL. The reader calls this every
// time the user tags, stars, archives, or edits a brief/kicker on an item.
//
// Body shape:
//   {
//     url: string,           required
//     tags?: string[],
//     starred?: boolean,
//     archived?: boolean,
//     brief?: string,
//     kicker?: string,
//   }
//
// Any fields omitted from the body are left unchanged. To clear a field, pass
// an explicit empty value (e.g. tags: [], brief: "").

import { getDb, COLLECTIONS } from "./_lib/mongo.js";
import { checkAuth, withCors } from "./_lib/auth.js";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = checkAuth(req, res, true);
  if (!auth.ok) return;

  const body = req.body || {};
  const url = (body.url || "").trim();
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  // Build the $set patch from whichever fields the client actually sent.
  const patch = {
    updatedAt: new Date(),
    updatedBy: auth.editor,
  };
  if (Array.isArray(body.tags)) patch.tags = body.tags.map(t => String(t).trim()).filter(Boolean);
  if (typeof body.starred === "boolean") patch.starred = body.starred;
  if (typeof body.archived === "boolean") patch.archived = body.archived;
  if (typeof body.brief === "string") patch.brief = body.brief;
  if (typeof body.kicker === "string") patch.kicker = body.kicker;

  // Post metadata — stored on every triage write so each record is a
  // self-contained, permanent entry in the searchable archive. This is what
  // lets Picks, the Front Page builder, and publish render a post WITHOUT the
  // live RSS feed (which only spans the last 14 days). Only overwrite a stored
  // field when the client sends a non-empty value, so a later feed-less write
  // never blanks metadata captured earlier.
  if (typeof body.title === "string" && body.title) patch.title = body.title;
  if (typeof body.author === "string" && body.author) patch.author = body.author;
  if (typeof body.sourceName === "string" && body.sourceName) patch.sourceName = body.sourceName;
  if (typeof body.image === "string") patch.image = body.image; // image may legitimately be "" 
  if (typeof body.date === "string" && body.date) patch.date = body.date;
  if (typeof body.excerpt === "string" && body.excerpt) patch.excerpt = body.excerpt;
  if (typeof body.group === "string" && body.group) patch.group = body.group;

  try {
    const db = await getDb();
    await db.collection(COLLECTIONS.TRIAGE).updateOne(
      { _id: url },
      {
        $set: patch,
        $setOnInsert: {
          createdAt: new Date(),
          createdBy: auth.editor,
        },
      },
      { upsert: true }
    );

    // Log to activity collection (best-effort; failures don't block the request)
    db.collection(COLLECTIONS.ACTIVITY).insertOne({
      type: "triage",
      url,
      editor: auth.editor,
      at: new Date(),
      changes: Object.keys(patch).filter(k => k !== "updatedAt" && k !== "updatedBy"),
    }).catch(() => { /* swallow */ });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("POST /api/triage error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
}

export default withCors(handler);