// Anthropic (Claude) helper — generates a house-style editorial "brief" for a
// blog post, the same kind of bulleted summary an editor would write by hand.
//
// Requires the ANTHROPIC_API_KEY environment variable. The model can be
// overridden with SUMMARY_MODEL (defaults to a current Sonnet).
//
// Output format (matches the briefs already in use on Science Notes):
//   <short punchy headline, no leading dash>
//   - first key point
//   - second key point
//   - third key point
//   (- optional fourth point)

// Accept the standard ANTHROPIC_API_KEY, or the anthropic_API name used in this
// project's Vercel env vars (Vercel won't let you rename a variable in place).
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.anthropic_API;
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You write short editorial summaries ("briefs") for Science Notes, a science-accountability publication that curates expert blog posts on public health, medicine, climate, and research integrity.

Given the full text of a blog post, write a brief in EXACTLY this format:
- Line 1: a short, vivid headline of at most 8 words. No leading dash, no markdown, no quotation marks.
- Then 3 to 4 lines, each beginning with "- " (a dash and a space). Each is ONE concise, factual point capturing the post's central claims, findings, numbers, or stakes.

Rules:
- Use the post's own facts, figures, and names. Be concrete and specific.
- Keep each bullet to a single short sentence or clause.
- Plain text only: no markdown bold, no headers, no preamble, no closing line.
- Output ONLY the headline line followed by the dash bullets — nothing else.`;

// Generate a brief. Returns the plain-text brief string.
// Throws on configuration or API errors.
export async function generateBrief({ title, author, sourceName, text }) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const userContent =
    `Post title: ${title || "(unknown)"}\n` +
    `Author: ${author || "(unknown)"}\n` +
    `Publication: ${sourceName || "(unknown)"}\n\n` +
    `Full post text:\n"""\n${text}\n"""\n\n` +
    `Write the brief now.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const out = (data.content || [])
    .map((block) => (block && block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  return out;
}
