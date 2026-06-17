// GET /api/homepage
//
// Serves the public homepage state LIVE from MongoDB on every request, in the
// exact shape the homepage (index.html) expects:
//   { schemaVersion, generatedAt, generatedBy, tagline, hero, featured,
//     selected, recent, feeds }
//
// This replaces the static state.json as the homepage's primary data source, so
// the front page always reflects the current Mongo state and never goes stale.
// state.json remains as an automatic fallback (see index.html) and is kept fresh
// by the scheduled /api/refresh-state job.
//
// Reads are public (no auth) unless EDITOR_ONLY_READ=true, matching /api/state.

import { getDb } from "./_lib/mongo.js";
import { buildFrontpageData } from "./_lib/frontpage.js";
import { checkAuth, withCors } from "./_lib/auth.js";

async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = checkAuth(req, res, false); // public read by default
  if (!auth.ok) return;

  try {
    const db = await getDb();
    const built = await buildFrontpageData(db); // no RSS items → render from triage

    if (!built.ok) {
      // No front page configured yet — let the client fall back to state.json.
      res.status(404).json({ error: built.error });
      return;
    }

    // Cache at the edge for a short window to spare the DB under traffic, while
    // staying fresh. CDN serves cached copies up to 60s and revalidates in the
    // background for up to 5 min.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300"
    );

    res.status(200).json({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "live",
      ...built.data,
    });
  } catch (err) {
    console.error("GET /api/homepage error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
}

export default withCors(handler);
