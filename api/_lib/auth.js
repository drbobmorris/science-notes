// Auth helper: verifies the x-sai-password header against the SAI_PASSWORD env var.
// This is intentionally simple — single shared password for the small editor group.
// Public site reads (GET /api/state) optionally bypass auth if EDITOR_ONLY_READ=false.

const SAI_PASSWORD = process.env.SAI_PASSWORD;
const EDITOR_ONLY_READ = process.env.EDITOR_ONLY_READ === "true";

if (!SAI_PASSWORD) {
  console.warn("SAI_PASSWORD environment variable is not set — all writes will be rejected");
}

// Returns { ok: true, editor: string } on success, or sends 401 and returns { ok: false }.
// Pass requireAuth=false for read endpoints that can be public.
export function checkAuth(req, res, requireAuth = true) {
  // Reads are public unless EDITOR_ONLY_READ is set
  if (!requireAuth && !EDITOR_ONLY_READ) {
    return { ok: true, editor: "public" };
  }

  const provided = req.headers["x-sai-password"];
  if (!SAI_PASSWORD || !provided || provided !== SAI_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return { ok: false };
  }

  // Editor name comes from a separate header. Falls back to "unknown".
  // The reader sets this from a per-machine localStorage value.
  const editor = (req.headers["x-sai-editor"] || "unknown").toString().slice(0, 40);
  return { ok: true, editor };
}

// Wraps a handler so OPTIONS requests get a clean response for CORS preflight.
// Vercel handles CORS headers via vercel.json, but the preflight needs a 200.
export function withCors(handler) {
  return async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }
    return handler(req, res);
  };
}
