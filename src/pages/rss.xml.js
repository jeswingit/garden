import rss from "@astrojs/rss"
import { getCollection } from "astro:content"
import site from "../data/site.json"

export async function GET(context) {
  const posts = (await getCollection("writing", (p) => !p.data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  )
  return rss({
    title: site.siteName,
    description: site.description,
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date,
      description: p.data.description,
      link: `/writing/${p.id}/`,
    })),
  })
}
