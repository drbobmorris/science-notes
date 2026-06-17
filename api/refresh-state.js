// GET /api/refresh-state
//
// Scheduled job (Vercel Cron — see vercel.json) that rebuilds state.json from
// the current MongoDB state and commits it to GitHub IF it has changed. This
// keeps the static state.json fallback fresh automatically, so the homepage's
// fallback is never badly out of date even when nobody clicks "Publish".
//
// The live homepage reads /api/homepage; this endpoint only maintains the
// committed snapshot/fallback. To avoid pointless redeploys it compares the new
// payload against the existing file (ignoring the always-changing timestamp) and
// commits only on a real content change.
//
// Auth: when CRON_SECRET is set, Vercel sends "Authorization: Bearer <secret>"
// on scheduled invocations; we require it. The editor password also works, so it
// can be triggered manually. If CRON_SECRET is unset, the endpoint runs open
// (and logs a warning) so it works before the secret is configured.

import { getDb } from "./_lib/mongo.js";
import { buildFrontpageData } from "./_lib/frontpage.js";
import { commitFile, getFileContent } from "./_lib/github.js";

const CRON_SECRET = process.env.CRON_SECRET;
const SAI_PASSWORD = process.env.SAI_PASSWORD;

// Strip volatile, non-content fields so identical front pages compare equal.
function stableKey(obj) {
  if (!obj || typeof obj !== "object") return "";
  const { generatedAt, generatedBy, ...rest } = obj;
  return JSON.stringify(rest);
}

function authorize(req) {
  if (!CRON_SECRET) {
    console.warn("CRON_SECRET not set — /api/refresh-state is running unauthenticated");
    return true;
  }
  const authHeader = req.headers["authorization"] || "";
  if (authHeader === `Bearer ${CRON_SECRET}`) return true;
  // Allow manual triggering with the editor password.
  const pw = req.headers["x-sai-password"];
  if (SAI_PASSWORD && pw && pw === SAI_PASSWORD) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!authorize(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const db = await getDb();
    const built = await buildFrontpageData(db); // render from stored triage metadata
    if (!built.ok) {
      res.status(200).json({ ok: true, skipped: "no frontpage configured" });
      return;
    }

    const out = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      generatedBy: "scheduled-refresh",
      ...built.data,
    };

    // Compare against the existing committed file; skip if nothing meaningful changed.
    let existing = null;
    try {
      existing = await getFileContent("state.json");
    } catch (e) {
      // Non-fatal: if we can't read the current file, just proceed to commit.
      console.warn("refresh-state: could not read current state.json:", e.message);
    }

    if (existing) {
      let existingParsed = null;
      try {
        existingParsed = JSON.parse(existing.content);
      } catch {
        existingParsed = null;
      }
      if (existingParsed && stableKey(existingParsed) === stableKey(out)) {
        res.status(200).json({ ok: true, changed: false });
        return;
      }
    }

    const stateJson = JSON.stringify(out, null, 2);
    const commit = await commitFile({
      path: "state.json",
      content: stateJson,
      message: `Auto-refresh state.json from MongoDB (${new Date()
        .toISOString()
        .slice(0, 10)})`,
      editor: "scheduled-refresh",
    });

    res.status(200).json({ ok: true, changed: true, commit });
  } catch (err) {
    console.error("GET /api/refresh-state error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
}
