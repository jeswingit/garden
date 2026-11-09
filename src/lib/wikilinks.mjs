// Shared by the remark plugin (build) and the backlinks calculation (pages).
export const WIKILINK = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g

export function normalize(target) {
  return target
    .trim()
    .replace(/^notes\//i, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
}

export function extractLinks(markdown) {
  const out = new Set()
  for (const m of markdown.matchAll(WIKILINK)) out.add(normalize(m[1]))
  return [...out]
}
