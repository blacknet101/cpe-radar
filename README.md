# CPE Radar

A free, neutral calendar of free CPE webinars, summits, and labs for CISSP, Security+, CISM and more.

- **Docs / plan:** [Notion – CPE Radar](https://www.notion.so/3fb09ccbb4e38183a5dcf93e1a8a6609)
- **Live:** https://cperadar.com (also https://cpe.blcknet.com)
- **Newsletter:** https://cpe-radar.beehiiv.com/subscribe

## Usage
- `python3 scripts/refresh.py` rebuilds `data/events.json` (BrightTALK RSS + Antisyphon API + `data/manual_events.json`) and checks every URL. Then `cp data/events.json site/`.
- Static preview: `cd site && python3 -m http.server 8765` (the forms need the Worker, below).
- Forms and site together: copy `.dev.vars.example` to `.dev.vars`, set `GITHUB_TOKEN`, then `npx wrangler dev`.
- Tests: `node --test`
- Deploy: Cloudflare Worker `cpe-radar` (`wrangler.jsonc`). Static files live in `site/`. There is no build command. Pushes to `main` auto-deploy. Branch preview builds run `npx wrangler preview`, which needs the empty `previews` block in that file.
- A weekly GitHub Action (`.github/workflows/refresh.yml`) runs the refresh and commits updated data.

## Form submissions

Submit Event and Sponsor post to `POST /api/submissions`. The Worker opens a GitHub issue in `blacknet101/cpe-radar`. A hidden honeypot field drops bots, and each IP can send 5 submissions per hour.

Josh reads them in the [Issues tab](https://github.com/blacknet101/cpe-radar/issues):

- Event submissions are titled `[event] …` and labeled `event-submission`.
- Sponsor inquiries are titled `[sponsor] …` and labeled `sponsor-inquiry`.

The Worker creates those labels on the first submission when the token is allowed to. GitHub does not email you about issues your own account opens, so the Issues tab is the inbox. To also get mail, set this repo’s watch level to **All Activity** (that mail goes to the address on the GitHub account).

### Secret

`GITHUB_TOKEN` is a Worker secret. Do not commit it. Build variables are not visible to the Worker at runtime.

1. GitHub → Settings → Developer settings → Fine-grained tokens. Limit it to `blacknet101/cpe-radar` with **Issues: Read and write**.
2. Cloudflare dashboard → Workers & Pages → **cpe-radar** → Settings → Variables and Secrets → add secret `GITHUB_TOKEN`.
   Or from a logged-in checkout: `npx wrangler secret put GITHUB_TOKEN`.
3. Optional plain var `GITHUB_REPO` if the issues should land in a different `owner/name`. The default is `blacknet101/cpe-radar`.

Until that secret is set, the forms show “Submissions are temporarily unavailable.” and nothing is stored. After it is set, submit one event and one sponsor note and confirm both issues. No redeploy is required for the secret itself; the merged Worker change has to be deployed first.
