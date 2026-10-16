let EV=[];const $=i=>document.getElementById(i);
fetch('events.json').then(r=>r.json()).then(d=>{EV=d.events;$('gen').textContent=new Date(d.generated).toLocaleDateString();
const certs=[...new Set(EV.flatMap(e=>e.certs))].sort(),fm=[...new Set(EV.map(e=>e.format))].sort();
certs.forEach(c=>$('cert').add(new Option(c,c)));fm.forEach(c=>$('fmt').add(new Option(c,c)));
['q','cert','fmt','when','auto'].forEach(i=>$(i).addEventListener('input',draw));draw();});
function draw(){const q=$('q').value.toLowerCase(),c=$('cert').value,f=$('fmt').value,w=+$('when').value,a=$('auto').checked,now=Date.now();
const r=EV.filter(e=>(!q||(e.title+e.host).toLowerCase().includes(q))&&(!c||e.certs.includes(c))&&(!f||e.format==f)&&(!a||e.auto_submit)&&(!w||new Date(e.start)-now<w*864e5));
$('count').textContent=r.length+' free events';
$('list').innerHTML=r.map(e=>{const d=new Date(e.start);return `<article><div class="date"><b>${d.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</b><small>${d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZoneName:'short'})}</small></div>
<div class="body"><a href="${e.url}" target="_blank" rel="noopener">${e.title}</a><div class="meta">${e.host} · ${e.format} · ${e.duration_min} min</div>
<div class="tags">${e.certs.map(x=>`<i>${x}</i>`).join('')}${e.auto_submit?'<i class="auto">auto-submit</i>':''}</div></div>
<div class="cpe">${e.cpe}<small>CPE${e.cpe_estimate?' est.':''}</small></div></article>`}).join('');}
