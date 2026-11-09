# Set up editing from the website

This turns on **Sign in with Google** and the in-page **edit / + new** buttons. It needs three free things: a Google sign-in client, a GitHub token and a Cloudflare Worker. Until you finish, the site works as normal and shows no sign-in link.

How it fits together: the page gets a signed ID token from Google, sends it with your edit to the Worker (`worker/`), the Worker checks the token and your email, then commits the change to this repo. The site rebuilds in about a minute. The GitHub token lives only in the Worker.

## 1. Google sign-in client (about 5 minutes)

1. Go to https://console.cloud.google.com and create a project (for example `garden`).
2. Open **APIs & Services -> OAuth consent screen** (or **Google Auth Platform**). App name `garden`, your email as support email, audience **External**. In *Testing* mode add your own Google account as a test user.
3. Open **Credentials -> Create credentials -> OAuth client ID -> Web application**.
4. Under **Authorised JavaScript origins** add `https://garden.jeswin.co` (and `http://localhost:4321` if you want to try it locally).
5. Create it and copy the **Client ID** (looks like `123...apps.googleusercontent.com`). It is public, not a secret.

## 2. GitHub token for the Worker (2 minutes)

GitHub -> Settings -> Developer settings -> Personal access tokens -> **Fine-grained tokens** -> Generate. Repository access: **only `jeswingit/garden`**. Permissions: **Contents -> Read and write**. Set an expiry and copy the token. Use a separate token from the one you use for `/admin`.

## 3. Deploy the Worker (5 minutes, needs Node 22 on your computer)

```
git clone https://github.com/jeswingit/garden
cd garden/worker
npx wrangler login
npx wrangler deploy
```

`deploy` prints your API address, like `https://garden-api.YOUR-NAME.workers.dev`. Then set three secrets (each command asks you to paste the value):

```
npx wrangler secret put GITHUB_TOKEN       # the token from step 2
npx wrangler secret put GOOGLE_CLIENT_ID   # the client ID from step 1
npx wrangler secret put ALLOWED_EMAILS     # your Google account email; several can be comma-separated
```

Your email is stored only as a Worker secret, not in this public repo.

## 4. Connect the site

Edit `src/data/editor.json` (on GitHub, press `.` in the repo to open the editor) and fill in both values:

```json
{
  "googleClientId": "123...apps.googleusercontent.com",
  "apiUrl": "https://garden-api.YOUR-NAME.workers.dev"
}
```

Commit it. When the deploy finishes, a **sign in** link appears in the site header. Sign in with your Google account and **edit** / **+ new** buttons appear on notes, posts, projects, Now, About and the home page.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Google shows `origin_mismatch` | Add `https://garden.jeswin.co` to the OAuth client's Authorised JavaScript origins (step 1.4). |
| "origin not allowed" | The site's address must be listed in `ALLOWED_ORIGINS` in `worker/wrangler.toml`; redeploy after changing it. |
| "bad audience" or "unauthorized" | `GOOGLE_CLIENT_ID` secret differs from the client ID used by the site. |
| "This Google account isn't allowed" | The account isn't in the `ALLOWED_EMAILS` secret. |
| "The file changed or already exists" | Reload the page and try again (something else edited it first). |
| Saved but nothing changed | Check the repo's **Actions** tab; a build error (for example a bad frontmatter field) keeps the old site live. |

Test the Worker's logic locally with `node worker/test.mjs`.
