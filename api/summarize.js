// POST /api/summarize
//
// Generates a house-style editorial brief (headline + 3–4 bullets) for a single
// blog post and returns it. Stateless: it does NOT write to the database — the
// Reader saves the returned brief through its normal triage-save path, so there
// is a single source of truth for writes.
//
// Body shape:
//   {
//     url:        string   (required) — the post URL; fetched for full text
//     title?:     string
//     author?:    string
//     sourceName?:string
//     excerpt?:   string   — feed snippet, used as fallback if the fetch is thin
//     text?:      string   — full text the caller already has (skips the fetch)
//   }
//
// Returns: { ok: true, brief, source } where source is "article" | "provided" | "fallback".
//
// Requires ANTHROPIC_API_KEY (and optionally SUMMARY_MODEL) in the environment.

import { checkAuth, withCors } from "./_lib/auth.js";
import { generateBrief } from "./_lib/anthropic.js";
import { fetchArticleText, htmlToText } from "./_lib/extract.js";

const MAX_CHARS = 14000; // bound the prompt size / token cost
const MIN_USABLE = 200; // below this, fetched text is considered too thin

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = checkAuth(req, res, true);
  if (!auth.ok) return;

  const body = req.body || {};
  const url = String(body.url || "").trim();
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const title = body.title || "";
  const author = body.author || "";
  const sourceName = body.sourceName || "";
  const providedText = String(body.text || "").trim();
  const excerpt = String(body.excerpt || "").trim();

  try {
    let text = "";
    let source = "";

    // 1) Caller-supplied full text wins (e.g. feed content the Reader already has).
    if (providedText && providedText.length >= MIN_USABLE) {
      text = htmlToText(providedText);
      source = "provided";
    }

    // 2) Otherwise fetch the article and extract its body.
    if (!text || text.length < MIN_USABLE) {
      try {
        const fetched = await fetchArticleText(url);
        if (fetched && fetched.length >= MIN_USABLE) {
          text = fetched;
          source = "article";
        }
      } catch (e) {
        console.warn("summarize: article fetch failed:", e.message);
      }
    }

    // 3) Last resort: the feed excerpt.
    if ((!text || text.length < MIN_USABLE) && excerpt) {
      text = excerpt;
      source = "fallback";
    }

    if (!text || text.length < 80) {
      res
        .status(422)
        .json({ error: "Not enough article text to summarize (the post may be paywalled or JS-rendered)" });
      return;
    }

    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

    const brief = await generateBrief({ title, author, sourceName, text });
    if (!brief) {
      res.status(502).json({ error: "Model returned an empty summary" });
      return;
    }

    res.status(200).json({ ok: true, brief, source });
  } catch (err) {
    console.error("POST /api/summarize error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
}

export default withCors(handler);
