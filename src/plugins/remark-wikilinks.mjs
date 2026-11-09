import fs from "node:fs"
import path from "node:path"
import { visit } from "unist-util-visit"
import { WIKILINK, normalize } from "../lib/wikilinks.mjs"

// Turns [[note]] and [[note|label]] into links to /notes/note/.
export default function remarkWikilinks() {
  const dir = path.resolve("src/content/notes")
  const known = () =>
    new Set(
      fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => normalize(f.replace(/\.md$/, "")))
        : [],
    )

  const titleOf = (slug) => {
    try {
      const raw = fs.readFileSync(path.join(dir, `${slug}.md`), "utf8")
      const m = raw.match(/^title:\s*["']?(.+?)["']?\s*$/m)
      return m ? m[1] : null
    } catch {
      return null
    }
  }

  return (tree) => {
    const slugs = known()
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined || !node.value.includes("[[")) return
      const parts = []
      let last = 0
      for (const m of node.value.matchAll(WIKILINK)) {
        if (m.index > last) parts.push({ type: "text", value: node.value.slice(last, m.index) })
        const slug = normalize(m[1])
        const label = (m[2] ?? (slugs.has(slug) ? titleOf(slug) : null) ?? m[1].replace(/^notes\//i, "")).trim()
        const children = [{ type: "text", value: label }]
        if (slugs.has(slug)) {
          parts.push({ type: "link", url: `/notes/${slug}/`, children, data: { hProperties: { className: ["wikilink"] } } })
        } else {
          parts.push({
            type: "emphasis",
            children,
            data: { hName: "span", hProperties: { className: ["wikilink", "missing"], title: "This note doesn't exist yet" } },
          })
        }
        last = m.index + m[0].length
      }
      if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) })
      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
  }
}
