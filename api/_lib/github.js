// GitHub API helper. Used by /api/publish to commit a regenerated state.json
// to the science-notes repo, which triggers a Vercel redeploy of the public site.

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GITHUB_OWNER || "drbobmorris";
const GH_REPO = process.env.GITHUB_REPO || "science-notes";
const GH_BRANCH = process.env.GITHUB_BRANCH || "main";

if (!GH_TOKEN) {
  console.warn("GITHUB_TOKEN not set — /api/publish will fail");
}

// Commit a single file to the repo. If the file already exists, this is a replacement
// (same path, new content). If it's new, this creates it.
//
// Uses the Contents API: PUT /repos/{owner}/{repo}/contents/{path}
// https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents
export async function commitFile({ path, content, message, editor }) {
  if (!GH_TOKEN) {
    throw new Error("GitHub token not configured");
  }

  // Get current SHA of the file (required when updating an existing file).
  // If the file doesn't exist, this returns 404 and we proceed without a sha.
  let currentSha = null;
  const getRes = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(path)}?ref=${GH_BRANCH}`,
    {
      headers: {
        "Authorization": `Bearer ${GH_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (getRes.ok) {
    const data = await getRes.json();
    currentSha = data.sha;
  } else if (getRes.status !== 404) {
    const errBody = await getRes.text();
    throw new Error(`GitHub GET failed (${getRes.status}): ${errBody.slice(0, 200)}`);
  }

  // Base64-encode the content. GitHub's Contents API requires base64.
  const contentB64 = Buffer.from(content, "utf-8").toString("base64");

  // PUT the file. If currentSha is set, this is an update; if null, a create.
  const body = {
    message,
    content: contentB64,
    branch: GH_BRANCH,
    committer: {
      name: editor || "SAI Reader",
      email: "editor@scienceaccountability.org",
    },
  };
  if (currentSha) body.sha = currentSha;

  const putRes = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(path)}`,
    {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${GH_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!putRes.ok) {
    const errBody = await putRes.text();
    throw new Error(`GitHub PUT failed (${putRes.status}): ${errBody.slice(0, 400)}`);
  }

  const result = await putRes.json();
  return {
    commitSha: result.commit?.sha,
    commitUrl: result.commit?.html_url,
    fileSha: result.content?.sha,
  };
}
