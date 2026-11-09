import cfg from "../data/editor.json"
import { parseMarkdown, serializeMarkdown, slugify } from "./frontmatter.js"

const { googleClientId, apiUrl } = cfg
const TOKEN_KEY = "garden.idtoken"
const SEEN_KEY = "garden.signedin"

const today = () => new Date().toISOString().slice(0, 10)

// Field definitions per content type. `body` is the Markdown after the frontmatter.
const TYPES = {
  notes: {
    label: "note", dir: "src/content/notes", url: (s) => `/notes/${s}/`, deletable: true,
    fields: [
      { k: "title", t: "text", label: "Title", req: true },
      { k: "status", t: "select", label: "Status", opts: ["seedling", "budding", "evergreen"], def: "seedling" },
      { k: "tags", t: "tags", label: "Tags (comma separated)" },
      { k: "body", t: "body", label: "Note (use [[note-name]] to link)" },
    ],
  },
  writing: {
    label: "post", dir: "src/content/writing", url: (s) => `/writing/${s}/`, deletable: true,
    fields: [
      { k: "title", t: "text", label: "Title", req: true },
      { k: "date", t: "date", label: "Date", req: true, def: today },
      { k: "description", t: "text", label: "Description" },
      { k: "draft", t: "bool", label: "Draft (hidden from the site)", def: false },
      { k: "body", t: "body", label: "Body (Markdown)" },
    ],
  },
  projects: {
    label: "project", dir: "src/content/projects", url: () => "/projects/", deletable: true,
    fields: [
      { k: "title", t: "text", label: "Title", req: true },
      { k: "description", t: "text", label: "One-line description", req: true },
      { k: "url", t: "text", label: "Website" },
      { k: "repo", t: "text", label: "Source repo" },
      { k: "status", t: "text", label: "Status" },
      { k: "order", t: "number", label: "Order (lower shows first)", def: 100 },
      { k: "body", t: "body", label: "Details (Markdown)" },
    ],
  },
  pages: {
    label: "page", dir: "src/content/pages", url: () => "/", deletable: false,
    fields: [
      { k: "title", t: "text", label: "Title", req: true },
      { k: "updated", t: "date", label: "Last updated", def: today },
      { k: "body", t: "body", label: "Body (Markdown)" },
    ],
  },
}

// ---------- tiny DOM helper (never uses innerHTML with data) ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v)
    else if (v === true) el.setAttribute(k, "")
    else if (v !== false && v != null) el.setAttribute(k, v)
  }
  for (const kid of kids.flat().filter(Boolean)) el.append(kid)
  return el
}

// ---------- auth ----------
const readToken = () => {
  try {
    const t = localStorage.getItem(TOKEN_KEY)
    if (!t) return null
    const exp = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp
    return exp * 1000 > Date.now() + 30_000 ? t : null
  } catch { return null }
}
const saveToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); localStorage.setItem(SEEN_KEY, "1") } catch {} }
const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY) } catch {} }

class AuthError extends Error {}

async function api(path, { method = "GET", body } = {}) {
  const token = readToken()
  if (!token) throw new AuthError("Signed out. Please sign in again.")
  const res = await fetch(apiUrl.replace(/\/$/, "") + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 || res.status === 403) { setEditMode(false); throw new AuthError(res.status === 403 ? "This Google account isn't allowed to edit." : "Session expired. Please sign in again.") }
  if (!res.ok) throw new Error(data.detail || data.error || `Request failed (${res.status})`)
  return data
}

let gisLoading
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve()
  gisLoading ??= new Promise((resolve, reject) => {
    document.head.append(h("script", { src: "https://accounts.google.com/gsi/client", async: true, onload: resolve, onerror: () => reject(new Error("Couldn't load Google sign-in")) }))
  })
  return gisLoading
}

let authSlot, popover
function renderAuth(state, message) {
  authSlot.replaceChildren()
  if (state === "in") {
    authSlot.append(
      h("span", { class: "auth-state" }, "editing"),
      h("button", { type: "button", class: "auth-btn", onclick: signOut }, "sign out"),
    )
  } else {
    authSlot.append(h("button", { type: "button", class: "auth-btn", onclick: openSignIn }, "sign in"))
    if (message) authSlot.append(h("span", { class: "auth-msg" }, message))
  }
}

function setEditMode(on) {
  document.body.classList.toggle("can-edit", on)
  if (!on) renderAuth("out")
}

async function handleCredential(resp) {
  saveToken(resp.credential)
  popover?.remove()
  popover = null
  try {
    await api("/api/me")
    setEditMode(true)
    renderAuth("in")
  } catch (e) {
    clearToken()
    renderAuth("out", e.message)
  }
}

async function openSignIn() {
  if (popover?.isConnected) { popover.remove(); popover = null; return }
  popover = h("div", { class: "auth-popover" }, h("p", { class: "dim" }, "Sign in with the Google account that owns this site."))
  authSlot.append(popover)
  try {
    await loadGoogle()
    window.google.accounts.id.initialize({ client_id: googleClientId, callback: handleCredential, auto_select: true })
    const holder = h("div")
    popover.append(holder)
    window.google.accounts.id.renderButton(holder, { theme: "filled_black", size: "medium", text: "signin_with" })
  } catch (e) {
    popover.append(h("p", { class: "auth-msg" }, e.message))
  }
}

function signOut() {
  clearToken()
  try { localStorage.removeItem(SEEN_KEY) } catch {}
  window.google?.accounts?.id?.disableAutoSelect?.()
  setEditMode(false)
}

// ---------- toast ----------
function toast(msg, kind = "ok") {
  const el = h("div", { class: `toast ${kind}`, role: "status" }, msg)
  document.body.append(el)
  setTimeout(() => el.remove(), 6000)
}

// ---------- editor panel ----------
function field(def, value) {
  const id = `f-${def.k}`
  let input
  if (def.t === "body") input = h("textarea", { id, rows: 14, spellcheck: "true" })
  else if (def.t === "select") input = h("select", { id }, def.opts.map((o) => h("option", { value: o }, o)))
  else if (def.t === "bool") input = h("input", { id, type: "checkbox" })
  else if (def.t === "date") input = h("input", { id, type: "date" })
  else if (def.t === "number") input = h("input", { id, type: "number", step: "1" })
  else input = h("input", { id, type: "text", autocomplete: "off" })

  if (def.t === "bool") input.checked = !!value
  else if (def.t === "tags") input.value = (Array.isArray(value) ? value : []).join(", ")
  else input.value = value ?? ""
  const wrap = h("div", { class: def.t === "bool" ? "field inline" : "field" }, h("label", { for: id }, def.label), input)
  const read = () => {
    if (def.t === "bool") return input.checked
    if (def.t === "tags") return input.value.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean)
    if (def.t === "number") return input.value === "" ? "" : Number(input.value)
    return input.value
  }
  return { wrap, read, input }
}

function panel(title, form, actions, status) {
  const close = () => { overlay.remove(); document.body.classList.remove("editing") }
  const overlay = h("div", { class: "editor-overlay", onmousedown: (e) => { if (e.target === overlay) close() } },
    h("div", { class: "editor-panel", role: "dialog", "aria-label": title },
      h("div", { class: "editor-head" }, h("strong", {}, title), h("button", { type: "button", class: "auth-btn", onclick: close }, "close")),
      form, status, h("div", { class: "editor-actions" }, actions)))
  document.body.classList.add("editing")
  document.body.append(overlay)
  return { overlay, close }
}

async function openContentEditor(type, path) {
  const T = TYPES[type]
  const isNew = !path
  let sha, fm = {}, body = ""
  const status = h("p", { class: "editor-status dim" }, isNew ? "" : "Loading…")
  const form = h("form", { class: "editor-form", onsubmit: (e) => e.preventDefault() })
  const saveBtn = h("button", { type: "button", class: "btn", disabled: true }, "Save")
  const delBtn = !isNew && T.deletable ? h("button", { type: "button", class: "btn danger", disabled: true }, "Delete") : null
  const { close } = panel(isNew ? `New ${T.label}` : `Edit ${T.label}`, form, [saveBtn, delBtn], status)

  try {
    if (!isNew) {
      const r = await api(`/api/file?path=${encodeURIComponent(path)}`)
      if (!r.exists) throw new Error("That file no longer exists.")
      sha = r.sha
      ;({ fm, body } = parseMarkdown(r.content))
    }
  } catch (e) { status.textContent = e.message; status.className = "editor-status error"; return }
  status.textContent = ""

  const inputs = T.fields.map((d) => {
    const v = d.k === "body" ? body : fm[d.k] ?? (typeof d.def === "function" ? d.def() : d.def)
    const f = field(d, v)
    form.append(f.wrap)
    return { d, ...f }
  })
  saveBtn.disabled = false
  if (delBtn) delBtn.disabled = false
  inputs[0].input.focus()

  saveBtn.addEventListener("click", async () => {
    const out = { ...fm }
    let newBody = body
    for (const { d, read } of inputs) {
      const v = read()
      if (d.req && (v === "" || v == null)) { status.textContent = `${d.label} is required.`; status.className = "editor-status error"; return }
      if (d.k === "body") newBody = v
      else out[d.k] = v
    }
    const order = T.fields.map((f) => f.k).filter((k) => k !== "body")
    const text = serializeMarkdown(out, newBody, order)
    saveBtn.disabled = true
    status.textContent = "Saving…"; status.className = "editor-status dim"
    try {
      let target = path
      if (isNew) {
        let slug = slugify(out.title), n = 2
        while ((await api(`/api/file?path=${encodeURIComponent(`${T.dir}/${slug}.md`)}`)).exists) slug = `${slugify(out.title)}-${n++}`
        target = `${T.dir}/${slug}.md`
      }
      await api("/api/file", { method: "PUT", body: { path: target, content: text, ...(sha ? { sha } : {}) } })
      close()
      const slug = target.split("/").pop().replace(/\.md$/, "")
      toast(`Saved. It will be live in about a minute${isNew ? ` at ${T.url(slug)}` : ""}.`)
    } catch (e) { status.textContent = e.message; status.className = "editor-status error"; saveBtn.disabled = false }
  })

  delBtn?.addEventListener("click", async () => {
    if (!confirm(`Delete this ${T.label}? This can be undone from the GitHub history.`)) return
    try {
      await api("/api/file", { method: "DELETE", body: { path, sha } })
      close()
      toast("Deleted. The site will update in about a minute.")
    } catch (e) { status.textContent = e.message; status.className = "editor-status error" }
  })
}

async function openSiteEditor() {
  const path = "src/data/site.json"
  const status = h("p", { class: "editor-status dim" }, "Loading…")
  const form = h("form", { class: "editor-form", onsubmit: (e) => e.preventDefault() })
  const saveBtn = h("button", { type: "button", class: "btn", disabled: true }, "Save")
  const { close } = panel("Edit home page and site settings", form, [saveBtn], status)

  let data, sha
  try {
    const r = await api(`/api/file?path=${encodeURIComponent(path)}`)
    sha = r.sha; data = JSON.parse(r.content)
  } catch (e) { status.textContent = e.message; status.className = "editor-status error"; return }
  status.textContent = ""

  const defs = [
    { k: "name", t: "text", label: "Your name", req: true },
    { k: "tagline", t: "text", label: "Tagline (role / interests)" },
    { k: "bio", t: "body", label: "Bio" },
    { k: "siteName", t: "text", label: "Site name (header)", req: true },
    { k: "description", t: "text", label: "Site description" },
    { k: "footerQuote", t: "text", label: "Footer quote" },
    { k: "footerQuoteAuthor", t: "text", label: "Quote author" },
  ]
  const fields = defs.map((d) => { const f = field(d, data[d.k]); if (d.k === "bio") f.input.rows = 4; form.append(f.wrap); return { d, ...f } })

  // photo
  const photo = field({ k: "photo", t: "text", label: "Photo (path under /images/, or upload below)" }, data.photo)
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/avif" })
  file.addEventListener("change", async () => {
    const f = file.files[0]
    if (!f) return
    if (f.size > 4_000_000) { status.textContent = "Image is over 4 MB."; status.className = "editor-status error"; return }
    status.textContent = "Uploading…"; status.className = "editor-status dim"
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f) })
      const name = f.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+/, "") || "photo.png"
      const target = `public/images/${name}`
      const ex = await api(`/api/file?path=${encodeURIComponent(target)}`)
      await api("/api/file", { method: "PUT", body: { path: target, content: b64, encoding: "base64", ...(ex.exists ? { sha: ex.sha } : {}) } })
      photo.input.value = `/images/${name}`
      status.textContent = "Uploaded. Save to use it."; status.className = "editor-status ok"
    } catch (e) { status.textContent = e.message; status.className = "editor-status error" }
  })
  form.append(photo.wrap, h("div", { class: "field" }, file))

  // links
  const rows = h("div", { class: "link-rows" })
  const addRow = (l = { label: "", url: "" }) => {
    const label = h("input", { type: "text", placeholder: "Label", value: l.label })
    const url = h("input", { type: "text", placeholder: "https://…", value: l.url })
    const row = h("div", { class: "link-row" }, label, url, h("button", { type: "button", class: "auth-btn", onclick: () => row.remove() }, "remove"))
    row.read = () => ({ label: label.value.trim(), url: url.value.trim() })
    rows.append(row)
  }
  ;(data.links || []).forEach(addRow)
  form.append(h("div", { class: "field" }, h("label", {}, "Link buttons"), rows, h("button", { type: "button", class: "auth-btn", onclick: () => addRow() }, "+ add link")))

  saveBtn.disabled = false
  saveBtn.addEventListener("click", async () => {
    const out = { ...data }
    for (const { d, read } of fields) {
      const v = read()
      if (d.req && !v) { status.textContent = `${d.label} is required.`; status.className = "editor-status error"; return }
      out[d.k] = v
    }
    out.photo = photo.read().trim()
    out.links = [...rows.children].map((r) => r.read()).filter((l) => l.label && l.url)
    saveBtn.disabled = true
    status.textContent = "Saving…"; status.className = "editor-status dim"
    try {
      await api("/api/file", { method: "PUT", body: { path, content: JSON.stringify(out, null, 2) + "\n", sha } })
      close()
      toast("Saved. The home page will update in about a minute.")
    } catch (e) { status.textContent = e.message; status.className = "editor-status error"; saveBtn.disabled = false }
  })
}

// ---------- page wiring ----------
function addButtons() {
  for (const el of document.querySelectorAll("[data-edit-path]")) {
    const type = el.dataset.editType, path = el.dataset.editPath
    el.append(h("button", { type: "button", class: "edit-btn", onclick: () => (type === "site" ? openSiteEditor() : openContentEditor(type, path)) }, "edit"))
  }
  for (const el of document.querySelectorAll("[data-new-type]")) {
    const type = el.dataset.newType
    el.append(h("button", { type: "button", class: "edit-btn", onclick: () => openContentEditor(type, null) }, `+ new ${TYPES[type].label}`))
  }
}

async function init() {
  authSlot = document.getElementById("auth-slot")
  if (!authSlot) return
  addButtons()
  renderAuth("out")
  if (readToken()) {
    try { await api("/api/me"); setEditMode(true); renderAuth("in") } catch (e) { clearToken(); renderAuth("out", e.message) }
  } else if (localStorage.getItem(SEEN_KEY)) {
    // Token expired: try Google's one-tap to get a fresh one without a click.
    try {
      await loadGoogle()
      window.google.accounts.id.initialize({ client_id: googleClientId, callback: handleCredential, auto_select: true })
      window.google.accounts.id.prompt()
    } catch {}
  }
}

if (googleClientId && apiUrl) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init)
  else init()
}
