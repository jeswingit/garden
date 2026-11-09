// Garden API: lets a signed-in Google account edit site content through GitHub commits.
// Runs on Cloudflare Workers (also runs on Node 22 for tests).

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
const GITHUB_API = "https://api.github.com"

// Only these paths can be read or written. Nothing else in the repo is reachable.
const CONTENT_RE = /^src\/content\/(notes|writing|projects|pages)\/[a-z0-9][a-z0-9_-]*\.md$/
const SITE_RE = /^src\/data\/site\.json$/
const IMAGE_RE = /^public\/images\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp|gif|avif)$/
const MAX_TEXT = 200_000
const MAX_IMAGE_B64 = 6_000_000

const isContent = (p) => CONTENT_RE.test(p)
const isSite = (p) => SITE_RE.test(p)
const isImage = (p) => IMAGE_RE.test(p)
const isAllowedPath = (p) => typeof p === "string" && (isContent(p) || isSite(p) || isImage(p))

// ---------- Google ID token verification ----------
let jwksCache = { at: 0, keys: [] }

const b64uToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/")
  while (s.length % 4) s += "="
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function getKey(kid, force = false) {
  if (force || Date.now() - jwksCache.at > 3600_000 || !jwksCache.keys.length) {
    const res = await fetch(JWKS_URL)
    if (!res.ok) throw new Error("jwks fetch failed")
    jwksCache = { at: Date.now(), keys: (await res.json()).keys }
  }
  return jwksCache.keys.find((k) => k.kid === kid)
}

export async function verifyGoogleToken(token, env) {
  const parts = (token || "").split(".")
  if (parts.length !== 3) throw new Error("malformed token")
  const header = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[0])))
  const payload = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[1])))
  if (header.alg !== "RS256") throw new Error("bad alg")

  let jwk = await getKey(header.kid)
  if (!jwk) jwk = await getKey(header.kid, true)
  if (!jwk) throw new Error("unknown key")
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64uToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  )
  if (!ok) throw new Error("bad signature")

  const now = Math.floor(Date.now() / 1000)
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) throw new Error("bad issuer")
  if (!env.GOOGLE_CLIENT_ID || payload.aud !== env.GOOGLE_CLIENT_ID) throw new Error("bad audience")
  if (!payload.exp || payload.exp < now - 30) throw new Error("expired")
  if (payload.email_verified !== true && payload.email_verified !== "true") throw new Error("email not verified")
  const allowed = (env.ALLOWED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (!payload.email || !allowed.includes(payload.email.toLowerCase())) throw new Error("not allowed")
  return payload
}

// ---------- content validation (keeps obviously broken files out of the build) ----------
export function validateText(path, text) {
  if (text.length > MAX_TEXT) return "file too large"
  if (isSite(path)) {
    let o
    try { o = JSON.parse(text) } catch { return "site.json is not valid JSON" }
    if (typeof o.name !== "string" || typeof o.siteName !== "string" || !Array.isArray(o.links)) return "site.json is missing required fields"
    return null
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return "missing frontmatter"
  const fm = m[1]
  if (!/^title:\s*\S/m.test(fm)) return "missing title"
  const type = path.split("/")[2]
  if (type === "writing" && !/^date:\s*\S/m.test(fm)) return "writing needs a date"
  if (type === "projects" && !/^description:\s*\S/m.test(fm)) return "projects need a description"
  return null
}

// ---------- GitHub ----------
const utf8ToB64 = (s) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)))

const gh = (env, path, init = {}) =>
  fetch(`${GITHUB_API}/repos/${env.GITHUB_REPO}/contents/${path}${init.method && init.method !== "GET" ? "" : `?ref=${env.GITHUB_BRANCH}`}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "garden-api",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  })

// ---------- HTTP ----------
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin")
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)
  if (origin && allowed.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    }
  }
  return null
}

const json = (data, status, cors) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...(cors || {}) } })

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env)
    if (request.headers.get("Origin") && !cors) return json({ error: "origin not allowed" }, 403)
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors || {} })

    const url = new URL(request.url)
    let user
    try {
      const auth = request.headers.get("Authorization") || ""
      user = await verifyGoogleToken(auth.replace(/^Bearer\s+/i, ""), env)
    } catch (e) {
      return json({ error: "unauthorized", detail: e.message }, e.message === "not allowed" ? 403 : 401, cors)
    }

    if (url.pathname === "/api/me" && request.method === "GET") return json({ email: user.email, allowed: true }, 200, cors)

    if (url.pathname !== "/api/file") return json({ error: "not found" }, 404, cors)

    try {
      if (request.method === "GET") {
        const path = url.searchParams.get("path")
        if (!isAllowedPath(path)) return json({ error: "path not allowed" }, 400, cors)
        const res = await gh(env, path)
        if (res.status === 404) return json({ exists: false }, 200, cors)
        if (!res.ok) return json({ error: "github error", status: res.status }, 502, cors)
        const f = await res.json()
        if (isImage(path)) return json({ exists: true, sha: f.sha }, 200, cors)
        return json({ exists: true, sha: f.sha, content: b64ToUtf8(f.content) }, 200, cors)
      }

      if (request.method === "PUT") {
        const body = await request.json()
        const { path, content, sha, encoding } = body
        if (!isAllowedPath(path)) return json({ error: "path not allowed" }, 400, cors)
        if (typeof content !== "string") return json({ error: "content required" }, 400, cors)

        let b64
        if (isImage(path)) {
          if (encoding !== "base64" || !/^[A-Za-z0-9+/=]+$/.test(content) || content.length > MAX_IMAGE_B64) {
            return json({ error: "invalid image upload" }, 400, cors)
          }
          b64 = content
        } else {
          if (encoding === "base64") return json({ error: "text files must be utf-8" }, 400, cors)
          const problem = validateText(path, content)
          if (problem) return json({ error: "invalid content", detail: problem }, 422, cors)
          b64 = utf8ToB64(content)
        }
        const res = await gh(env, path, {
          method: "PUT",
          body: JSON.stringify({
            message: `${sha ? "Edit" : "Add"} ${path} via website`,
            content: b64,
            branch: env.GITHUB_BRANCH,
            ...(sha ? { sha } : {}),
          }),
        })
        if (res.status === 409 || res.status === 422) return json({ error: "conflict", detail: "The file changed or already exists. Reload and try again." }, 409, cors)
        if (!res.ok) return json({ error: "github error", status: res.status }, 502, cors)
        const out = await res.json()
        return json({ ok: true, sha: out.content?.sha, commit: out.commit?.sha }, 200, cors)
      }

      if (request.method === "DELETE") {
        const { path, sha } = await request.json()
        if (!isContent(path) || typeof sha !== "string") return json({ error: "path not allowed" }, 400, cors)
        const res = await gh(env, path, {
          method: "DELETE",
          body: JSON.stringify({ message: `Delete ${path} via website`, sha, branch: env.GITHUB_BRANCH }),
        })
        if (res.status === 409 || res.status === 422) return json({ error: "conflict", detail: "The file changed. Reload and try again." }, 409, cors)
        if (!res.ok) return json({ error: "github error", status: res.status }, 502, cors)
        return json({ ok: true }, 200, cors)
      }

      return json({ error: "method not allowed" }, 405, cors)
    } catch (e) {
      return json({ error: "bad request" }, 400, cors)
    }
  },
}
