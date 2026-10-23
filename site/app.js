// Hide an event once its start instant has passed. Compare instants, not UTC
// calendar dates: a session later this US evening stays listed until it
// begins, even when that timestamp already falls on the next UTC date.
// The same rule is what scripts/refresh.py and scripts/seo.py apply at
// generation time; this keeps the list current between Monday refreshes.
function isUpcoming(event, now) {
  const start = Date.parse(event.start);
  return Number.isFinite(start) && start >= now;
}

function visibleEvents(events, options = {}) {
  const now = options.now ?? Date.now();
  const query = (options.q || "").toLowerCase();
  const cert = options.cert || "";
  const format = options.format || "";
  const autoOnly = !!options.autoOnly;
  const windowMs = (+options.withinDays || 0) * 86_400_000;
  return events.filter((event) => {
    const start = Date.parse(event.start);
    if (!isUpcoming(event, now)) return false;
    if (query && !(event.title + event.host).toLowerCase().includes(query)) return false;
    if (cert && !event.certs.includes(cert)) return false;
    if (format && event.format !== format) return false;
    if (autoOnly && !event.auto_submit) return false;
    // Upper bound only. Past events are already removed above; a negative
    // start-now delta must not satisfy "Next N days".
    if (windowMs && start - now >= windowMs) return false;
    return true;
  });
}

function pageSize() {
  return 10;
}

// The catalog is one static array. Render a page at a time so the list has
// an end instead of growing for as long as the visitor scrolls.
function listWindow(events, limit) {
  const total = events.length;
  const size = Math.max(0, Math.floor(Number(limit)) || pageSize());
  const shown = events.slice(0, size);
  return { events: shown, total, shown: shown.length, remaining: total - shown.length };
}

function moreState(windowed) {
  if (!windowed.total) return { status: "", button: false };
  if (!windowed.remaining) return { status: "End of the list", button: false };
  return { status: `Showing ${windowed.shown} of ${windowed.total}`, button: true };
}

function renderEvent(event) {
  const d = new Date(event.start);
  const when = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const tags = event.certs.map((cert) => `<i>${cert}</i>`).join("") + (event.auto_submit ? '<i class="auto">auto-submit</i>' : "");
  return `<article><div class="date"><b>${when}</b><small>${time}</small></div>
<div class="body"><a href="${event.url}" target="_blank" rel="noopener">${event.title}</a><div class="meta">${event.host} · ${event.format} · ${event.duration_min} min</div>
<div class="tags">${tags}</div></div>
<div class="cpe">${event.cpe}<small>CPE${event.cpe_estimate ? " est." : ""}</small></div></article>`;
}

function bootCalendar() {
  const $ = (id) => document.getElementById(id);
  let events = [];
  let drawn = "";
  let limit = pageSize();
  let filterKey = "";

  $("more").addEventListener("click", () => {
    limit += pageSize();
    draw();
  });

  fetch("events.json")
    .then((res) => res.json())
    .then((data) => {
      events = data.events;
      $("gen").textContent = new Date(data.generated).toLocaleDateString();
      const certs = [...new Set(events.flatMap((event) => event.certs))].sort();
      const formats = [...new Set(events.map((event) => event.format))].sort();
      certs.forEach((cert) => $("cert").add(new Option(cert, cert)));
      formats.forEach((format) => $("fmt").add(new Option(format, format)));
      ["q", "cert", "fmt", "when", "auto"].forEach((id) => $(id).addEventListener("input", draw));
      draw();
      // An open tab drops an event within a minute of its start, and again
      // when the visitor comes back the next morning.
      setInterval(draw, 60_000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") draw();
      });
    });

  function filters() {
    return {
      q: $("q").value,
      cert: $("cert").value,
      format: $("fmt").value,
      withinDays: +$("when").value,
      autoOnly: $("auto").checked,
    };
  }

  function draw() {
    const options = filters();
    const key = JSON.stringify(options);
    const filterChanged = key !== filterKey;
    if (filterChanged) {
      filterKey = key;
      limit = pageSize();
    }
    const matched = visibleEvents(events, options);
    const windowed = listWindow(matched, limit);
    const state = moreState(windowed);
    const count = matched.length + " free events";
    const html = windowed.events.map(renderEvent).join("");
    const signature = [count, html, state.status, state.button].join("\n");
    if (signature === drawn) return;
    drawn = signature;
    $("count").textContent = count;
    const list = $("list");
    // Append on "Load more" so iOS keeps the scroll position. Replace when
    // the filter set itself changed.
    if (!filterChanged && list.children.length > 0 && list.children.length < windowed.events.length) {
      list.insertAdjacentHTML("beforeend", windowed.events.slice(list.children.length).map(renderEvent).join(""));
    } else {
      list.innerHTML = html;
    }
    $("more-wrap").hidden = windowed.total === 0;
    $("more-status").textContent = state.status;
    $("more").hidden = !state.button;
  }
}

if (typeof document !== "undefined") bootCalendar();
