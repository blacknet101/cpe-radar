#!/usr/bin/env python3
"""CPE Radar refresh: pulls upcoming free events from public feeds -> data/events.json
Sources: BrightTALK channel RSS feeds, Antisyphon (The Events Calendar REST API)."""
import re, json, html, datetime as dt, urllib.request, sys, os
UA={'User-Agent':'Mozilla/5.0 (CPE Radar refresh)'}
NOW=dt.datetime.now(dt.timezone.utc)
OUT=os.path.join(os.path.dirname(__file__),'..','data','events.json')
BT_CHANNELS={288:'ISC2',5385:'ISC2',5586:None,11673:None,19566:None,15591:None,2037:None,8241:None,17216:None,18504:None,19088:None}
BT_CHANNELS.update({int(k):v for k,v in (a.split('=',1) for a in sys.argv[1:] if '=' in a)})
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30).read().decode('utf-8','replace')
def tag(s,t):
    m=re.search(rf'<{t}[^>]*>(.*?)</{t}>',s,re.S); return html.unescape(m.group(1)).strip() if m else ''
def cpe_from(text):
    m=re.search(r'(?:up to\s+)?(\d+(?:\.\d+)?)\s*(?:Group\s*[AB]\s*)?CPE',text,re.I)
    return (float(m.group(1)),True) if m else None
def certs_for(host,text,stated):
    c=['CISSP','CCSP','SSCP'] if host=='ISC2' else ['CISSP','CISM','CISA','Security+','CySA+']
    if host!='ISC2': c=['CISSP','CISM','Security+','CySA+','CASP+']
    return c
def brighttalk():
    ev=[]
    for ch,host in BT_CHANNELS.items():
        try: s=get(f'https://www.brighttalk.com/channel/{ch}/feed/rss')
        except Exception as e: print('ERR',ch,e,file=sys.stderr); continue
        chtitle=tag(s,'title')
        for it in re.findall(r'<item>(.*?)</item>',s,re.S):
            if 'status="upcoming"' not in it: continue
            cm=re.search(r'<brighttalk:communication[^>]*>',it).group(0)
            start=dt.datetime.fromtimestamp(int(re.search(r'utc="(\d+)"',cm).group(1)),dt.timezone.utc)
            if start<NOW: continue
            title=tag(it,'title'); desc=re.sub('<[^>]+>',' ',tag(it,'description'))
            dur=re.search(r'duration="(\d+)"',cm)
            mins=int(dur.group(1))//60 if dur else 60
            c=cpe_from(title+' '+desc)
            link=tag(it,'link') or tag(it,'guid')
            h=host or chtitle
            ev.append(dict(title=title,host=h,start=start.isoformat(),timezone='UTC',duration_min=mins,format='Webinar',
                cpe=c[0] if c else round(max(mins,30)/60*2)/2,cpe_estimate=not c,
                certs=certs_for(host,desc,c),auto_submit=(host=='ISC2'),cpe_note=('ISC2 auto-submits CPEs for members attending live/on-demand' if host=='ISC2' else 'Self-report; keep attendance certificate'),
                url=link,source=f'BrightTALK channel {ch} RSS ({chtitle})',free=True))
    return ev
def antisyphon():
    d=json.loads(get('https://www.antisyphontraining.com/wp-json/tribe/events/v1/events?start_date='+NOW.date().isoformat()+'&per_page=100'))
    ev=[]
    for e in d['events']:
        cats=[c['name'] for c in e.get('categories',[])]
        cost=(e.get('cost') or '').strip()
        free=('Anti-Cast' in cats) or cost.lower() in ('','free') and ('Summit' in cats) or cost.lower()=='free' or 'Free Workshop' in e['title']
        if not free: continue
        t=html.unescape(e['title'])
        st=dt.datetime.fromisoformat(e['utc_start_date'].replace(' ','T')+'+00:00'); en=dt.datetime.fromisoformat(e['utc_end_date'].replace(' ','T')+'+00:00')
        mins=int((en-st).total_seconds()//60)
        fmt='Summit' if 'Summit' in cats else 'Workshop' if 'Workshop' in cats else 'Webinar'
        ev.append(dict(title=t,host='Antisyphon Training / Black Hills InfoSec',start=st.isoformat(),timezone=e['timezone'],duration_min=mins,format=fmt,
            cpe=round(min(mins,480)/60,1),cpe_estimate=True,certs=['CISSP','CISM','Security+','CySA+','GIAC'],auto_submit=False,
            url=e['url'],source='antisyphontraining.com Events API',free=True))
    return ev
def verify(ev):
    for e in ev:
        try: urllib.request.urlopen(urllib.request.Request(e['url'],headers=UA),timeout=20); e['url_ok']=True
        except Exception as x: e['url_ok']=getattr(x,'code',None) in (403,429)  # bot-blocked but live
    return ev
if __name__=='__main__':
    ev=brighttalk()+antisyphon()
    manual=os.path.join(os.path.dirname(OUT),'manual_events.json')
    if os.path.exists(manual): ev+= [m for m in json.load(open(manual)) if m['start']>=NOW.isoformat()]
    ev=verify(sorted(ev,key=lambda e:e['start']))
    json.dump(dict(generated=NOW.isoformat(),count=len(ev),events=ev),open(OUT,'w'),indent=1)
    print(len(ev),'events;',sum(not e['url_ok'] for e in ev),'bad urls')
