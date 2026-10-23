const MAX_BODY_BYTES = 16_384;
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 60 * 60;
const SUCCESS_MESSAGE = "Thanks — we received it and will review it.";

const FORMATS = new Set(["Webinar", "Virtual Summit", "Workshop", "Lab / CTF", "Quiz"]);
const INTERESTS = new Set(["Featured calendar spot", "Newsletter sponsor", "Both"]);

const LABEL_DEFS = {
  event: {
    name: "event-submission",
    color: "1D76DB",
    description: "Free CPE event submitted from cperadar.com",
  },
  sponsor: {
    name: "sponsor-inquiry",
    color: "F5B301",
    description: "Sponsor inquiry from cperadar.com",
  },
};

const BACK = {
  event: { href: "/submit.html", label: "Back to the form" },
  sponsor: { href: "/sponsor.html", label: "Back to the form" },
};

export async function handleSubmission(request, env, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const cache = deps.cache === undefined ? defaultCache() : deps.cache;
  const limit = deps.limit ?? RATE_LIMIT;
  const windowSeconds = deps.windowSeconds ?? RATE_WINDOW_SECONDS;

  if (request.method !== "POST") {
    return respond(request, 405, {
      ok: false,
      error: "Use the form on this site to send a submission.",
      ...unknownBack(),
    }, { Allow: "POST" });
  }

  if (!sameOrigin(request)) {
    console.log(JSON.stringify({ message: "submission rejected", reason: "origin" }));
    return respond(request, 403, {
      ok: false,
      error: "Submissions have to be sent from this site.",
      ...unknownBack(),
    });
  }

  const body = await readLimited(request, MAX_BODY_BYTES);
  if (body.error) {
    return respond(request, 413, {
      ok: false,
      error: "That submission is too large.",
      ...unknownBack(),
    });
  }

  const parsed = parseBody(request, body.text);
  if (!parsed.ok) {
    return respond(request, 400, {
      ok: false,
      error: "Check the form and try again.",
      ...unknownBack(),
    });
  }

  const kind = parsed.data.kind === "sponsor" ? "sponsor" : parsed.data.kind === "event" ? "event" : "";
  const back = BACK[kind] || unknownBack();

  if (await rateLimited(request, cache, limit, windowSeconds)) {
    console.log(JSON.stringify({ message: "submission rejected", reason: "rate-limit", kind: kind || "unknown" }));
    return respond(request, 429, {
      ok: false,
      error: "Too many submissions from this network. Please try again later.",
      ...back,
    }, { "Retry-After": String(windowSeconds) });
  }

  if (honeypotTripped(parsed.data)) {
    console.log(JSON.stringify({ message: "submission dropped", reason: "honeypot", kind: kind || "unknown" }));
    return respond(request, 200, { ok: true, message: SUCCESS_MESSAGE, ...back });
  }

  if (!kind) {
    return respond(request, 400, {
      ok: false,
      error: "Check the form and try again.",
      ...unknownBack(),
    });
  }

  const fields = kind === "event" ? validateEvent(parsed.data) : validateSponsor(parsed.data);
  if (!fields.ok) {
    console.log(JSON.stringify({ message: "submission rejected", reason: "validation", kind, field: fields.field }));
    return respond(request, 400, { ok: false, error: fields.error, ...back });
  }

  const repo = repoPath(env);
  const token = typeof env?.GITHUB_TOKEN === "string" ? env.GITHUB_TOKEN.trim() : "";
  if (!repo || !token) {
    console.error(JSON.stringify({
      message: "submission unavailable",
      reason: !token ? "missing-token" : "bad-repo",
    }));
    return respond(request, 503, {
      ok: false,
      error: "Submissions are temporarily unavailable.",
      ...back,
    });
  }

  const issue = buildIssue(kind, fields.value);
  const created = await openIssue(fetchImpl, token, repo, issue);
  if (!created.ok) {
    console.error(JSON.stringify({
      message: "github issue failed",
      kind,
      status: created.status,
      github: created.github,
    }));
    return respond(request, 502, {
      ok: false,
      error: "We couldn't send that. Please try again in a few minutes.",
      ...back,
    });
  }

  console.log(JSON.stringify({
    message: "submission created",
    kind,
    issue: created.number ?? null,
    labeled: created.labeled,
  }));
  return respond(request, 200, { ok: true, message: SUCCESS_MESSAGE, ...back });
}

export function buildIssue(kind, fields) {
  const label = LABEL_DEFS[kind];
  if (kind === "event") {
    return {
      title: clip(neutralizeMentions(`[event] ${fields.title}`), 240),
      labels: [label.name],
      labelDefs: [label],
      body: [
        "### Event submission",
        "",
        field("Title", fields.title),
        field("Host", fields.host),
        field("When", fields.when),
        field("Format", fields.format),
        field("CPE credits", fields.cpe),
        field("Registration URL", fields.url),
        "",
        `Link: <${fields.url}>`,
        "",
        field("Contact email", fields.email),
        "",
        "_Sent from the Submit Event form on cperadar.com._",
      ].join("\n"),
    };
  }

  return {
    title: clip(neutralizeMentions(`[sponsor] ${fields.company}`), 240),
    labels: [label.name],
    labelDefs: [label],
    body: [
      "### Sponsor inquiry",
      "",
      field("Company", fields.company),
      field("Work email", fields.email),
      field("Interest", fields.interest),
      field("What they are promoting", fields.message),
      "",
      "_Sent from the Sponsor form on cperadar.com._",
    ].join("\n"),
  };
}

function field(label, value) {
  const text = value ? value : "not provided";
  return `**${label}**\n\n\`\`\`\n${text}\n\`\`\``;
}

function mentionsLabel(parsed) {
  const detail = `${parsed?.message || ""} ${JSON.stringify(parsed?.errors || [])}`.toLowerCase();
  return detail.includes("label");
}

async function openIssue(fetchImpl, token, repo, issue) {
  let result = await github(fetchImpl, token, `/repos/${repo}/issues`, {
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
  });
  if (result.status === 201) return { ok: true, number: result.parsed.number, labeled: true };

  if (result.status === 422 && mentionsLabel(result.parsed)) {
    for (const label of issue.labelDefs) {
      await github(fetchImpl, token, `/repos/${repo}/labels`, label);
    }
    result = await github(fetchImpl, token, `/repos/${repo}/issues`, {
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
    });
    if (result.status === 201) return { ok: true, number: result.parsed.number, labeled: true };

    result = await github(fetchImpl, token, `/repos/${repo}/issues`, {
      title: issue.title,
      body: issue.body,
    });
    if (result.status === 201) return { ok: true, number: result.parsed.number, labeled: false };
  }

  return { ok: false, status: result.status, github: String(result.parsed.message || "").slice(0, 200) };
}

async function github(fetchImpl, token, path, payload) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "cpe-radar-forms",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  return { status: response.status, parsed };
}

function validateEvent(data) {
  const title = cleanLine(data.title, 200);
  if (title.length < 3) return fail("title", "Event title is required.");
  const url = cleanUrl(data.url);
  if (url.error) return fail("url", url.error);
  const email = cleanEmail(data.email, false);
  if (email.error) return fail("email", email.error);
  const when = cleanWhen(data.when);
  if (when.error) return fail("when", when.error);
  const format = cleanLine(data.format, 40);
  if (!FORMATS.has(format)) return fail("format", "Choose a format.");
  return {
    ok: true,
    value: {
      title,
      host: cleanLine(data.host, 200),
      when: when.value,
      format,
      cpe: cleanLine(data.cpe, 40),
      url: url.value,
      email: email.value,
    },
  };
}

function validateSponsor(data) {
  const company = cleanLine(data.company, 200);
  if (company.length < 2) return fail("company", "Company is required.");
  const email = cleanEmail(data.email, true);
  if (email.error) return fail("email", email.error);
  const interest = cleanLine(data.interest, 80);
  if (!INTERESTS.has(interest)) return fail("interest", "Choose what you want to sponsor.");
  return {
    ok: true,
    value: {
      company,
      email: email.value,
      interest,
      message: cleanText(data.message, 4000),
    },
  };
}

function fail(fieldName, error) {
  return { ok: false, field: fieldName, error };
}

function parseBody(request, text) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  try {
    if (type.includes("application/json")) {
      const data = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false };
      return { ok: true, data };
    }
    if (type.includes("application/x-www-form-urlencoded") || type === "") {
      const data = {};
      for (const [key, value] of new URLSearchParams(text)) data[key] = value;
      return { ok: true, data };
    }
  } catch {
    return { ok: false };
  }
  return { ok: false };
}

function honeypotTripped(data) {
  const value = data.hp_field;
  if (value == null) return false;
  if (typeof value !== "string") return true;
  return value.trim() !== "";
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function readLimited(request, max) {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > max) return { error: "too-large" };
  if (!request.body) return { text: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* already closed */ }
      return { error: "too-large" };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { text };
}

async function rateLimited(request, cache, limit, windowSeconds) {
  if (!cache) return false;
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const hash = await sha256(ip);
    const key = new Request(`https://cperadar.com/__rl/${hash}`);
    const hit = await cache.match(key);
    const count = hit ? Number(await hit.text()) || 0 : 0;
    if (count >= limit) return true;
    await cache.put(key, new Response(String(count + 1), {
      headers: { "Cache-Control": `public, max-age=${windowSeconds}` },
    }));
    return false;
  } catch (error) {
    console.error(JSON.stringify({
      message: "rate limit unavailable",
      error: error instanceof Error ? error.message : "cache",
    }));
    return false;
  }
}

function defaultCache() {
  try {
    if (typeof caches !== "undefined" && caches.default) return caches.default;
  } catch { /* not a Worker runtime */ }
  return null;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function repoPath(env) {
  const repo = (typeof env?.GITHUB_REPO === "string" && env.GITHUB_REPO.trim()) || "blacknet101/cpe-radar";
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : "";
}

function cleanLine(value, max) {
  return clip(asString(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/`/g, "'").replace(/\s+/g, " ").trim(), max);
}

function cleanText(value, max) {
  const text = asString(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/`/g, "'")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clip(text, max);
}

function cleanEmail(value, required) {
  const email = cleanLine(value, 200);
  if (!email) return required ? { error: "Email is required." } : { value: "" };
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  return { value: email };
}

function cleanUrl(value) {
  const raw = asString(value).trim();
  if (!raw) return { error: "Registration URL is required." };
  if (raw.length > 500) return { error: "Registration URL is too long." };
  let url;
  try { url = new URL(raw); } catch { return { error: "Registration URL must be an http(s) link." }; }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    return { error: "Registration URL must be an http(s) link." };
  }
  const href = url.toString();
  if (href.includes(">") || href.includes(")") || /\s/.test(href)) {
    return { error: "Registration URL must be an http(s) link." };
  }
  return { value: href };
}

function cleanWhen(value) {
  const when = cleanLine(value, 40);
  if (!when) return { value: "" };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(when)) return { error: "Enter a valid date and time." };
  return { value: when };
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function clip(value, max) {
  return value.length > max ? value.slice(0, max) : value;
}

function neutralizeMentions(value) {
  return value.replace(/@/g, "@\u200b");
}

function unknownBack() {
  return { href: "/index.html", label: "Back to the calendar" };
}

function wantsJson(request) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  const accept = (request.headers.get("accept") || "").toLowerCase();
  return type.includes("application/json") || (accept.includes("application/json") && !accept.includes("text/html"));
}

function respond(request, status, payload, extraHeaders = {}) {
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  };
  if (wantsJson(request)) {
    return new Response(JSON.stringify({ ok: payload.ok, message: payload.message, error: payload.error }), {
      status,
      headers: { ...headers, "content-type": "application/json; charset=utf-8" },
    });
  }
  const ok = payload.ok;
  return new Response(renderPage({
    title: ok ? "Thanks · CPE Radar" : "Not sent · CPE Radar",
    heading: ok ? "Thanks" : "Not sent",
    message: payload.message || payload.error || "Something went wrong.",
    back: payload.href || "/index.html",
    backLabel: payload.label || "Back to the calendar",
  }), {
    status,
    headers: {
      ...headers,
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}

function renderPage({ title, heading, message, back, backLabel }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/style.css"></head><body><header><a class="logo" href="/index.html">◎ CPE Radar</a><nav><a href="/index.html">Calendar</a><a href="/submit.html">Submit an event</a><a href="/sponsor.html">Sponsor</a></nav></header><div class="page"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(back)}">${escapeHtml(backLabel)}</a></p></div></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
