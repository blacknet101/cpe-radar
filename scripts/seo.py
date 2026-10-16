"""Regenerate sitemap.xml, robots.txt, and JSON-LD/meta in site/*.html from site/events.json."""
import json, re, datetime, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent / "site"
BASE = "https://cperadar.com"
data = json.loads((ROOT / "events.json").read_text())
today = datetime.date.today().isoformat()
pages = {"index.html": ("/", "CPE Radar: Free CPE Webinars & Events for CISSP, Security+, CISM",
          "CPE Radar is a free calendar of CPE webinars, virtual summits and workshops for CISSP, Security+, CISM and more, plus a weekly free-CPE newsletter. Updated weekly."),
         "submit.html": ("/submit.html", "Submit a Free CPE Event · CPE Radar", "Submit a free CPE webinar, summit or workshop to the CPE Radar calendar."),
         "sponsor.html": ("/sponsor.html", "Sponsor CPE Radar · Reach CISSP, Security+ & CISM Holders", "Feature your webinar on CPE Radar and the weekly free-CPE newsletter for certified security professionals.")}
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
up = [e for e in data["events"] if e["start"] >= now][:30]
def ev(e):
    s = datetime.datetime.fromisoformat(e["start"]); end = s + datetime.timedelta(minutes=e.get("duration_min") or 60)
    return {"@type": "Event", "name": e["title"], "startDate": e["start"], "endDate": end.isoformat(),
            "eventAttendanceMode": "https://schema.org/OnlineEventAttendanceMode", "eventStatus": "https://schema.org/EventScheduled",
            "location": {"@type": "VirtualLocation", "url": e["url"]}, "url": e["url"],
            "organizer": {"@type": "Organization", "name": e["host"]}, "isAccessibleForFree": True,
            "offers": {"@type": "Offer", "price": 0, "priceCurrency": "USD", "availability": "https://schema.org/InStock", "url": e["url"]},
            "description": f"Free {e.get('format','event')} worth ~{e.get('cpe')} CPE for {', '.join(e.get('certs',[]))}."}
org = {"@type": "Organization", "@id": BASE + "/#org", "name": "CPE Radar", "url": BASE + "/", "logo": BASE + "/og.png"}
site = {"@type": "WebSite", "@id": BASE + "/#website", "name": "CPE Radar", "alternateName": ["CPERadar", "cperadar.com"], "url": BASE + "/", "publisher": {"@id": BASE + "/#org"}}
for f, (path, title, desc) in pages.items():
    p = ROOT / f; h = p.read_text()
    h = re.sub(r"\s*<!--seo-->.*?<!--/seo-->", "", h, flags=re.S)
    h = re.sub(r"<title>.*?</title>\s*", "", h, flags=re.S)
    h = re.sub(r'\s*<meta (name="description"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>', "", h)
    h = re.sub(r'\s*<link rel="canonical"[^>]*>', "", h)
    graph = [org, site]
    if f == "index.html" and up:
        graph.append({"@type": "ItemList", "name": "Upcoming free CPE events", "itemListElement":
                      [{"@type": "ListItem", "position": i + 1, "item": ev(e)} for i, e in enumerate(up)]})
    esc = lambda s: s.replace("&", "&amp;").replace('"', "&quot;")
    block = f'''<!--seo--><title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{BASE}{path}">
<meta property="og:type" content="website"><meta property="og:site_name" content="CPE Radar">
<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{BASE}{path}"><meta property="og:image" content="{BASE}/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(desc)}"><meta name="twitter:image" content="{BASE}/og.png">
<script type="application/ld+json">{json.dumps({"@context": "https://schema.org", "@graph": graph}).replace("</", "<\\/")}</script><!--/seo-->'''
    h = h.replace("<head>", "<head><meta charset=\"utf-8\">" + block, 1).replace(block + "<meta charset=\"utf-8\">", block, 1)
    p.write_text(h)
urls = "".join(f"<url><loc>{BASE}{v[0]}</loc><lastmod>{today}</lastmod><changefreq>{'weekly' if k=='index.html' else 'monthly'}</changefreq></url>\n" for k, v in pages.items())
(ROOT / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n')
(ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n")
print("seo ok:", len(up), "events in schema")
