// Shared front-page builder.
//
// Produces the published front-page payload (tagline, hero/featured, selected,
// recent, feeds) from the current MongoDB state (config + triage). This is the
// single source of truth used by BOTH:
//   - GET  /api/homepage     → serves it live to the public site on every visit
//   - POST /api/publish      → bakes it into a committed state.json snapshot
//   - GET  /api/refresh-state→ refreshes the state.json fallback on a schedule
//
// Centralizing it here guarantees the live homepage and any published snapshot
// can never drift apart.
//
// Triage documents store self-contained post metadata (title, author, image,
// date, excerpt) on every write, so the page can be rebuilt WITHOUT the live
// RSS feed. Callers that DO have fresh RSS items in hand (the reader, at publish
// time) may pass them in via `itemsByUrl` to prefer the freshest data; callers
// that don't (the live endpoint, the cron) simply omit it and render from the
// stored triage metadata.

import { COLLECTIONS, CONFIG_DOC_ID } from "./mongo.js";

// Build the front-page data object from Mongo.
//
//   db         - connected db handle (from getDb())
//   itemsByUrl - optional { [link]: { title, author, sourceName, date, image, excerpt } }
//                map of live RSS items; preferred over stored metadata when present.
//
// Returns { ok: true, data: {...} } on success, or { ok: false, error } when no
// front page has been configured yet.
export async function buildFrontpageData(db, itemsByUrl = {}) {
  const configDoc = await db
    .collection(COLLECTIONS.CONFIG)
    .findOne({ _id: CONFIG_DOC_ID });

  if (!configDoc?.frontpage) {
    return { ok: false, error: "No frontpage configured yet" };
  }
  const fp = configDoc.frontpage;

  // All starred posts: the source for the auto-filled "recent" list.
  const allStarred = await db
    .collection(COLLECTIONS.TRIAGE)
    .find({ starred: true })
    .toArray();

  const triageByUrl = {};
  for (const t of allStarred) triageByUrl[t._id] = t;

  // The hero and selected slots might point at posts that aren't starred. Pull
  // their triage docs too, so feed-less rendering still has their metadata.
  const slotUrls = [fp.heroUrl, ...(fp.selectedUrls || [])]
    .filter(Boolean)
    .filter((u) => !triageByUrl[u]);
  if (slotUrls.length) {
    const extra = await db
      .collection(COLLECTIONS.TRIAGE)
      .find({ _id: { $in: slotUrls } })
      .toArray();
    for (const t of extra) triageByUrl[t._id] = t;
  }

  // Build a published-post object from URL + triage + (optional) live RSS item.
  // Prefers fresh feed data, falls back to metadata stored on the triage doc.
  function serialize(url) {
    if (!url) return null;
    const item = itemsByUrl[url]; // live RSS item, if supplied
    const t = triageByUrl[url] || {}; // triage doc (has stored metadata)
    const src = item || t; // prefer fresh feed data, else stored
    if (!src || !src.title) return null; // nothing to render with
    return {
      title: src.title,
      link: url,
      author: src.author || "",
      sourceName: src.sourceName || "",
      date: src.date || null,
      image: src.image || "",
      excerpt: src.excerpt || "",
      brief: t.brief || "",
      kicker:
        t.kicker ||
        (Array.isArray(t.tags) && t.tags[0] ? t.tags[0].toUpperCase() : ""),
      tags: Array.isArray(t.tags) ? t.tags : [],
    };
  }

  // Featured (pinned hero) + ordered Selected (up to 6, never duplicating hero).
  const featured = serialize(fp.heroUrl);
  const selected = (fp.selectedUrls || [])
    .filter((u) => u && u !== fp.heroUrl)
    .map(serialize)
    .filter(Boolean)
    .slice(0, 6);

  // Recent: built from stored metadata so it doesn't depend on the live feed.
  const exclude = new Set(
    [fp.heroUrl, ...(fp.selectedUrls || [])].filter(Boolean)
  );
  const recent = allStarred
    .filter((t) => !exclude.has(t._id) && (itemsByUrl[t._id] || t.title))
    .map((t) => ({
      url: t._id,
      date: (itemsByUrl[t._id] && itemsByUrl[t._id].date) || t.date,
    }))
    .sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db_ = b.date ? new Date(b.date).getTime() : 0;
      return db_ - da;
    })
    .slice(0, fp.recentCount || 6)
    .map(({ url }) => serialize(url))
    .filter(Boolean);

  return {
    ok: true,
    data: {
      tagline: fp.tagline || "",
      hero: featured, // "hero" key retained for the homepage consumer
      featured, // explicit alias for the new featured+selected model
      selected,
      recent,
      feeds: configDoc.feeds || { scientists: [], writers: [] },
    },
  };
}
