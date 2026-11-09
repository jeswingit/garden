// Run with: node worker/test.mjs
import assert from "node:assert/strict"
import worker, { validateText } from "./src/index.js"

const b64u = (b) => Buffer.from(b).toString("base64url")
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" }
const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])

const CLIENT = "client-123.apps.googleusercontent.com"
async function token(over = {}, key = kp.privateKey) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }))
  const p = b64u(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT, email: "me@example.com", email_verified: true, exp: Math.floor(Date.now() / 1000) + 600, ...over }))
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`))
  return `${h}.${p}.${b64u(sig)}`
}

// fake GitHub contents store
const store = new Map()
const calls = []
globalThis.fetch = async (url, init = {}) => {
  url = String(url)
  if (url.startsWith("https://www.googleapis.com/oauth2/v3/certs")) return new Response(JSON.stringify({ keys: [jwk] }))
  const m = url.match(/\/repos\/([^/]+\/[^/]+)\/contents\/([^?]+)/)
  if (!m) throw new Error("unexpected fetch " + url)
  const path = decodeURIComponent(m[2])
  const method = init.method || "GET"
  calls.push({ method, path, headers: init.headers, body: init.body && JSON.parse(init.body) })
  if (method === "GET") {
    const f = store.get(path)
    return f ? new Response(JSON.stringify({ sha: f.sha, content: f.content })) : new Response("{}", { status: 404 })
  }
  const b = JSON.parse(init.body)
  const cur = store.get(path)
  if (method === "PUT") {
    if (cur && b.sha !== cur.sha) return new Response("{}", { status: 409 })
    if (!cur && b.sha) return new Response("{}", { status: 422 })
    const sha = "sha" + store.size + Math.random().toString(16).slice(2, 6)
    store.set(path, { sha, content: b.content })
    return new Response(JSON.stringify({ content: { sha }, commit: { sha: "c1" } }))
  }
  if (method === "DELETE") { if (!cur || cur.sha !== b.sha) return new Response("{}", { status: 409 }); store.delete(path); return new Response("{}") }
}

const env = { GOOGLE_CLIENT_ID: CLIENT, ALLOWED_EMAILS: "Me@Example.com, other@example.com", GITHUB_TOKEN: "ghp_secret", GITHUB_REPO: "o/r", GITHUB_BRANCH: "main", ALLOWED_ORIGINS: "https://garden.jeswin.co" }
const ORIGIN = "https://garden.jeswin.co"
const call = async (method, path, { tok, body, origin = ORIGIN } = {}) => {
  const headers = { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(origin ? { Origin: origin } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }
  const res = await worker.fetch(new Request("https://api.test" + path, { method, headers, body: body && JSON.stringify(body) }), env)
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers }
}
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log("ok -", name) }

const good = await token()
const note = "---\ntitle: Hello\nstatus: seedling\n---\n\nBody ü\n"

await t("rejects missing/garbage token", async () => {
  assert.equal((await call("GET", "/api/me")).status, 401)
  assert.equal((await call("GET", "/api/me", { tok: "a.b.c" })).status, 401)
})
await t("accepts valid token, case-insensitive allowlist", async () => {
  const r = await call("GET", "/api/me", { tok: good })
  assert.equal(r.status, 200); assert.equal(r.json.allowed, true)
})
await t("rejects wrong audience, expired, unverified email, wrong signer, non-allowlisted", async () => {
  for (const over of [{ aud: "evil" }, { exp: 1 }, { email_verified: false }, { iss: "https://evil.com" }]) {
    assert.equal((await call("GET", "/api/me", { tok: await token(over) })).status, 401, JSON.stringify(over))
  }
  assert.equal((await call("GET", "/api/me", { tok: await token({}, other.privateKey) })).status, 401)
  assert.equal((await call("GET", "/api/me", { tok: await token({ email: "stranger@example.com" }) })).status, 403)
})
await t("CORS: blocks other origins, answers preflight", async () => {
  assert.equal((await call("GET", "/api/me", { tok: good, origin: "https://evil.com" })).status, 403)
  const pre = await call("OPTIONS", "/api/file")
  assert.equal(pre.status, 204); assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN)
})
await t("path allowlist", async () => {
  for (const p of ["package.json", ".github/workflows/deploy.yml", "src/content/notes/../../../package.json", "src/content/notes/UP.md", "public/admin/config.yml", "src/content/other/x.md", "public/images/a.svg", "worker/src/index.js"]) {
    assert.equal((await call("GET", "/api/file?path=" + encodeURIComponent(p), { tok: good })).status, 400, p)
    assert.equal((await call("PUT", "/api/file", { tok: good, body: { path: p, content: note } })).status, 400, p)
  }
})
await t("create, read back (utf-8), update with sha, conflict", async () => {
  const p = "src/content/notes/hello.md"
  assert.equal((await call("GET", "/api/file?path=" + p, { tok: good })).json.exists, false)
  const c = await call("PUT", "/api/file", { tok: good, body: { path: p, content: note } })
  assert.equal(c.status, 200)
  assert.equal(calls.at(-1).headers.Authorization, "Bearer ghp_secret")
  assert.match(calls.at(-1).body.message, /Add src\/content\/notes\/hello.md via website/)
  const r = await call("GET", "/api/file?path=" + p, { tok: good })
  assert.equal(r.json.content, note)
  const u = await call("PUT", "/api/file", { tok: good, body: { path: p, content: note + "more\n", sha: r.json.sha } })
  assert.equal(u.status, 200)
  assert.equal((await call("PUT", "/api/file", { tok: good, body: { path: p, content: note, sha: r.json.sha } })).status, 409)
  assert.equal((await call("PUT", "/api/file", { tok: good, body: { path: p, content: note } })).status, 409)
})
await t("validation blocks broken content", async () => {
  const bad = (path, content) => call("PUT", "/api/file", { tok: good, body: { path, content } })
  assert.equal((await bad("src/content/notes/x.md", "no frontmatter")).status, 422)
  assert.equal((await bad("src/content/notes/x.md", "---\nstatus: seedling\n---\n")).status, 422)
  assert.equal((await bad("src/content/writing/x.md", "---\ntitle: T\n---\n")).status, 422)
  assert.equal((await bad("src/data/site.json", "{not json")).status, 422)
  assert.equal((await bad("src/data/site.json", "{}")).status, 422)
  assert.equal(validateText("src/data/site.json", JSON.stringify({ name: "a", siteName: "b", links: [] })), null)
})
await t("images: base64 only, and not for text paths", async () => {
  const png = Buffer.from("fakepng").toString("base64")
  assert.equal((await call("PUT", "/api/file", { tok: good, body: { path: "public/images/me.png", content: png, encoding: "base64" } })).status, 200)
  assert.equal((await call("PUT", "/api/file", { tok: good, body: { path: "public/images/me.png", content: "not base64!!" } })).status, 400)
  assert.equal((await call("PUT", "/api/file", { tok: good, body: { path: "src/content/notes/y.md", content: png, encoding: "base64" } })).status, 400)
  assert.equal(store.get("public/images/me.png").content, png)
})
await t("delete only content files, needs matching sha", async () => {
  const p = "src/content/notes/hello.md"
  const r = await call("GET", "/api/file?path=" + p, { tok: good })
  assert.equal((await call("DELETE", "/api/file", { tok: good, body: { path: p, sha: "stale" } })).status, 409)
  assert.equal((await call("DELETE", "/api/file", { tok: good, body: { path: "src/data/site.json", sha: "x" } })).status, 400)
  assert.equal((await call("DELETE", "/api/file", { tok: good, body: { path: "public/images/me.png", sha: "x" } })).status, 400)
  assert.equal((await call("DELETE", "/api/file", { tok: good, body: { path: p, sha: r.json.sha } })).status, 200)
  assert.equal(store.has(p), false)
})
console.log(`\n${n} test groups passed`)
