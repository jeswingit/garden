# Jeswin's Garden

A digital garden built with [Quartz](https://quartz.jzhao.xyz). Notes are Markdown files in `content/`; every push to `main` rebuilds and publishes the site to GitHub Pages.

## One-time setup

1. Create a **public** GitHub repo named `garden` and push this folder to it:
   ```
   git init -b main
   git add . && git commit -m "Initial garden"
   git remote add origin https://github.com/jeswingit/garden.git
   git push -u origin main
   ```
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Edit `quartz.config.yaml`: replace `jeswingit` in `baseUrl` and the footer link (keep `baseUrl` without `https://`).
4. Push. The site appears at `https://jeswingit.github.io/garden/` after about a minute (see the **Actions** tab).

For a custom domain such as `garden.jeswin.co`, set it in Settings → Pages, then change `baseUrl` to `garden.jeswin.co`.

## Custom domain (garden.jeswin.co)

1. In Cloudflare DNS for jeswin.co add a **CNAME**: name `garden`, target `jeswingit.github.io`, proxy status **DNS only**.
2. In the repo go to **Settings -> Pages -> Custom domain**, enter `garden.jeswin.co`, save, and tick **Enforce HTTPS** once the certificate is ready.

`baseUrl` in `quartz.config.yaml` is already `garden.jeswin.co`.

## Editing from the website

Go to `https://garden.jeswin.co/admin/` and choose **Sign in with Token**.

1. Create a token at GitHub -> Settings -> Developer settings -> Personal access tokens -> **Fine-grained tokens**.
2. Repository access: **only** `jeswingit/garden`. Permissions: **Contents -> Read and write**.
3. Paste the token in the editor. It is stored in that browser only, so repeat on each device.

Saving a note commits to `main`, and the site rebuilds in about a minute. The editor is in `admin/` (copied into the site by the workflow); change fields or collections in `admin/config.yml`.

Alternative with no setup: open the repo and press `.` for GitHub's own editor.

Start new notes from `content/templates/new-note.md`:

```
---
title: My note
status: seedling   # seedling | budding | evergreen
tags: []
---
```

Link notes with `[[note name]]`. Backlinks appear automatically.

## Private notes

Put anything private in a `content/private/` folder. It is excluded from the site build **and** from git (see `.gitignore`), so it never reaches GitHub. That also means it only exists on the computer where you wrote it, so don't rely on it for browser editing.

## Writing locally

Open the `content/` folder as an Obsidian vault, or run `npm install && npx quartz build --serve` to preview at http://localhost:8080.
