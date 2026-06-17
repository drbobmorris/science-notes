// Article text extraction. Fetches a post URL server-side (no CORS limits on
// the server) and reduces the HTML to readable plain text for summarization.
//
// This is deliberately lightweight rather than a full readability engine: it
// prefers the <article> element when present, strips scripts/styles/markup, and
// collapses whitespace. Good enough to feed a summarizer; the model tolerates
// some residual navigation text.

// Convert an HTML string to plain text.
export function htmlToText(html) {
  if (!html) return "";
  let s = String(html);

  // Prefer the main <article> region if the page has one (Substack, most blogs).
  const article = s.match(/<article[\s\S]*?<\/article>/i);
  if (article) s = article[0];

  // Drop non-content elements entirely.
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Turn block-level boundaries into newlines so sentences don't run together.
  s = s
    .replace(/<\/(p|div|section|h[1-6]|li|blockquote|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, " ");

  // Decode the most common HTML entities.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&#8217;/gi, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/gi, '"')
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&ndash;|&#8211;/gi, "–")
    .replace(/&hellip;|&#8230;/gi, "…");

  // Collapse whitespace.
  s = s
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s;
}

// Fetch a URL and return its extracted plain text. Throws on network/HTTP error.
export async function fetchArticleText(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // A browser-like UA avoids some basic bot blocks.
      "User-Agent":
        "Mozilla/5.0 (compatible; SAIReaderBot/1.0; +https://notes.scienceaccountability.org)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`Article fetch failed (${res.status})`);
  }
  const html = await res.text();
  return htmlToText(html);
}
