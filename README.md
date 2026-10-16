# CPE Radar

A free, neutral calendar of free CPE webinars, summits, and labs for CISSP, Security+, CISM and more.

- **Docs / plan:** [Notion – CPE Radar](https://www.notion.so/3fb09ccbb4e38183a5dcf93e1a8a6609)
- **Live:** https://cperadar.com (also https://cpe.blcknet.com)
- **Newsletter:** https://cpe-radar.beehiiv.com/subscribe

## Usage
- `python3 scripts/refresh.py` rebuilds `data/events.json` (BrightTALK RSS + Antisyphon API + `data/manual_events.json`) and checks every URL. Then `cp data/events.json site/`.
- Serve locally: `cd site && python3 -m http.server 8765`
- Deploy: Cloudflare Pages, build output dir `site/`, no build command.
- A weekly GitHub Action (`.github/workflows/refresh.yml`) runs the refresh and commits updated data.
