import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"
import remarkWikilinks from "./src/plugins/remark-wikilinks.mjs"

export default defineConfig({
  site: "https://garden.jeswin.co",
  integrations: [sitemap()],
  markdown: {
    remarkPlugins: [remarkWikilinks],
    shikiConfig: { theme: "github-dark" },
  },
})
