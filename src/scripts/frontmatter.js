// Minimal frontmatter reader/writer for the flat fields this site uses.

const unquote = (v) => {
  v = v.trim()
  if (v.startsWith('"') && v.endsWith('"')) {
    try { return JSON.parse(v) } catch { return v.slice(1, -1) }
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
  return v
}

const scalar = (v) => {
  const raw = v.trim()
  if (raw === "true") return true
  if (raw === "false") return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return unquote(raw)
}

export function parseMarkdown(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { fm: {}, body: text }
  const lines = m[1].split(/\r?\n/)
  const fm = {}
  let i = 0
  while (i < lines.length) {
    const km = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!km) { i++; continue }
    const [, key, val] = km
    if (val === "") {
      const items = []
      let j = i + 1
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) { items.push(unquote(lines[j].replace(/^\s*-\s+/, ""))); j++ }
      fm[key] = items.length ? items : ""
      i = items.length ? j : i + 1
      continue
    }
    if (/^\[.*\]$/.test(val.trim())) {
      fm[key] = val.trim().slice(1, -1).split(",").map(unquote).filter(Boolean)
    } else {
      fm[key] = scalar(val)
    }
    i++
  }
  return { fm, body: m[2].replace(/^(\r?\n)+/, "") }
}

const dateOnly = /^\d{4}-\d{2}-\d{2}$/

function line(key, v) {
  if (Array.isArray(v)) return v.length ? `${key}:\n${v.map((x) => `  - ${JSON.stringify(String(x))}`).join("\n")}` : `${key}: []`
  if (typeof v === "boolean" || typeof v === "number") return `${key}: ${v}`
  if (v === "" || v == null) return null
  if (dateOnly.test(v)) return `${key}: ${v}`
  const str = String(v)
  const plain = /^[A-Za-z][A-Za-z0-9 _.\/-]*$/.test(str) && str === str.trim() && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(str)
  return `${key}: ${plain ? str : JSON.stringify(str)}`
}

// `order` lists known keys first; any other keys in fm are kept after them.
export function serializeMarkdown(fm, body, order) {
  const keys = [...order.filter((k) => k in fm), ...Object.keys(fm).filter((k) => !order.includes(k))]
  const out = keys.map((k) => line(k, fm[k])).filter(Boolean)
  return `---\n${out.join("\n")}\n---\n\n${body.replace(/\s+$/, "")}\n`
}

export const slugify = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled"
