// Anthropic (Claude) helper — generates a house-style editorial "brief" for a
// blog post, the same kind of bulleted summary an editor would write by hand.
//
// Requires the ANTHROPIC_API_KEY environment variable. The model can be
// overridden with SUMMARY_MODEL (defaults to a current Sonnet).
//
// The brief is capped at BRIEF_CHAR_LIMIT characters total so it can be reposted
// to any platform (well under Bluesky's 300 / X's 280 limits). Format:
//   <short headline, no leading dash>
//   - first key point
//   - second key point
//   (- optional third point)

// Accept the standard ANTHROPIC_API_KEY, or the anthropic_API name used in this
// project's Vercel env vars (Vercel won't let you rename a variable in place).
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.anthropic_API;
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || "claude-sonnet-4-6";

// Hard cap on the whole brief (headline + bullets + line breaks).
const BRIEF_CHAR_LIMIT = 220;

const SYSTEM_PROMPT = `You write very short editorial summaries ("briefs") for Science Notes, a science-accountability publication that curates expert blog posts on public health, medicine, climate, and research integrity. Each brief must be repostable to any social platform.

Given the full text of a blog post, write a brief in EXACTLY this format:
- Line 1: a short, vivid headline of at most 7 words. No leading dash, no markdown, no quotation marks.
- Then 2 to 3 lines, each beginning with "- " (a dash and a space). Each is ONE very concise, factual point capturing the post's central claims, findings, numbers, or stakes.

HARD LIMIT: the ENTIRE brief — headline plus every bullet, including spaces and line breaks — must be ${BRIEF_CHAR_LIMIT} characters or fewer. This is non-negotiable. Be ruthless: cut adjectives and filler, use numerals, drop bullets if needed to fit.

Rules:
- Use the post's own facts, figures, and names. Be concrete and specific.
- Plain text only: no markdown bold, no headers, no preamble, no closing line.
- Output ONLY the headline line followed by the dash bullets — nothing else.`;

// Low-level call: send a messages array, return the model's text output.
async function callClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  return (data.content || [])
    .map((block) => (block && block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

// Generate a brief (<= BRIEF_CHAR_LIMIT chars). Returns the plain-text brief.
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
    `Write the brief now, ${BRIEF_CHAR_LIMIT} characters or fewer total.`;

  const messages = [{ role: "user", content: userContent }];
  let out = await callClaude(messages);

  // Enforce the cap: if the model overshot, ask it once to tighten with the
  // exact overage called out. Models comply reliably given the concrete count.
  if (out.length > BRIEF_CHAR_LIMIT) {
    messages.push({ role: "assistant", content: out });
    messages.push({
      role: "user",
      content: `That is ${out.length} characters — too long. Rewrite it to ${BRIEF_CHAR_LIMIT} characters or fewer total (headline + bullets), same format, plain text only. Drop a bullet if you must.`,
    });
    const retry = await callClaude(messages);
    if (retry) out = retry;
  }

  return out;
}
