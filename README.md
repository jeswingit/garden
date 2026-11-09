# garden

Personal website built with [Astro](https://astro.build): a home page, **notes** (a digital garden with `[[wiki links]]` and backlinks), **writing**, **projects**, **now** and **about**. Every push to `main` rebuilds and deploys to GitHub Pages at https://garden.jeswin.co.

## Where things live

| What | File(s) |
| --- | --- |
| Hero text, links, footer quote, site name | `src/data/site.json` |
| Notes | `src/content/notes/*.md` (`status`: seedling, budding or evergreen) |
| Writing | `src/content/writing/*.md` |
| Projects | `src/content/projects/*.md` |
| Now / About | `src/content/pages/now.md`, `about.md` |
| Hero photo | put an image in `public/images/` and set `photo` in `site.json` (e.g. `/images/me.png`) |
| Colours, fonts, layout | `src/styles/global.css`, `src/layouts/Base.astro` |

Link notes with `[[note-file-name]]` or `[[note-file-name|label]]`. Backlinks appear on each note automatically. A link to a note that doesn't exist yet shows dashed.

## Edit from the browser

Go to https://garden.jeswin.co/admin/ and **Sign in with Token** (a GitHub fine-grained token limited to this repo, with Contents: Read and write). Saving commits to `main` and the site rebuilds in about a minute. Collections and fields are defined in `public/admin/config.yml`.

## Run locally

```
npm install
npm run dev      # http://localhost:4321
npm run build    # output in dist/
```

Needs Node 22 or newer.

## Private notes

Put them in `private/` (git-ignored, never published). They stay on your own computer only.
