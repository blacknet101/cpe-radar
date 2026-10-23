import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { route } from "../src/index.mjs";

const TOKEN = "test-token-not-real";

function memoryCache() {
  const store = new Map();
  return {
    async match(request) {
      const hit = store.get(request.url);
      if (!hit || hit.expires <= Date.now()) return undefined;
      return new Response(hit.body, { headers: { "Cache-Control": hit.cacheControl } });
    },
    async put(request, response) {
      const cacheControl = response.headers.get("Cache-Control") || "";
      const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)?.[1] || 0);
      store.set(request.url, {
        body: await response.text(),
        cacheControl,
        expires: Date.now() + maxAge * 1000,
      });
    },
  };
}

function githubMock(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, body: JSON.parse(init.body), headers: init.headers };
    calls.push(call);
    const result = await handler(call, calls);
    return new Response(JSON.stringify(result.body ?? {}), { status: result.status, headers: result.headers });
  };
  return { fetchImpl, calls };
}

function created(number = 1) {
  return { status: 201, body: { number, html_url: `https://github.com/blacknet101/cpe-radar/issues/${number}` } };
}

function post(data, { origin = "https://cperadar.com", ip = "203.0.113.10", accept = "application/json", type = "application/json" } = {}) {
  const body = type.includes("json") ? JSON.stringify(data) : new URLSearchParams(data).toString();
  return new Request("https://cperadar.com/api/submissions", {
    method: "POST",
    headers: {
      "Content-Type": type,
      Accept: accept,
      Origin: origin,
      "CF-Connecting-IP": ip,
    },
    body,
  });
}

const event = {
  kind: "event",
  title: "Free CISSP webinar",
  host: "Example Org",
  when: "2026-11-02T15:00",
  format: "Webinar",
  cpe: "1",
  url: "https://example.com/register",
  email: "ada@example.com",
  hp_field: "",
};

const sponsor = {
  kind: "sponsor",
  company: "Acme Security",
  email: "pat@acme.example",
  interest: "Both",
  message: "A free lab\nfor CISSP holders",
  hp_field: "",
};

function env(extra = {}) {
  return { GITHUB_TOKEN: TOKEN, ...extra };
}

async function submit(data, options = {}, mock = githubMock(() => created())) {
  const response = await route(post(data, options), env(options.env), {
    fetch: mock.fetchImpl,
    cache: options.cache ?? memoryCache(),
    limit: options.limit,
    windowSeconds: options.windowSeconds,
  });
  return { response, json: await response.clone().json().catch(() => null), calls: mock.calls, text: await response.text() };
}

test("event submission opens a labeled GitHub issue", async () => {
  const { response, json, calls } = await submit(event);
  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.match(json.message, /received it/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/blacknet101/cpe-radar/issues");
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].init.redirect, "manual");
  assert.deepEqual(calls[0].body.labels, ["event-submission"]);
  assert.match(calls[0].body.title, /^\[event\] Free CISSP webinar/);
  assert.match(calls[0].body.body, /Free CISSP webinar/);
  assert.match(calls[0].body.body, /https:\/\/example\.com\/register/);
  assert.match(calls[0].body.body, /ada@example.com/);
  assert.doesNotMatch(calls[0].body.body, new RegExp(TOKEN));
});

test("sponsor submission opens a sponsor issue and keeps line breaks", async () => {
  const { response, calls } = await submit(sponsor, { ip: "203.0.113.20" });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].body.labels, ["sponsor-inquiry"]);
  assert.match(calls[0].body.title, /^\[sponsor\] Acme Security/);
  assert.match(calls[0].body.body, /pat@acme\.example/);
  assert.match(calls[0].body.body, /A free lab\nfor CISSP holders/);
});

test("honeypot returns success and does not call GitHub", async () => {
  const { response, json, calls } = await submit({ ...event, hp_field: "https://spam.example" });
  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(calls.length, 0);
});

test("missing required fields and bad urls never reach GitHub", async () => {
  const missing = await submit({ ...event, title: "  " });
  assert.equal(missing.response.status, 400);
  assert.match(missing.json.error, /title/i);
  assert.equal(missing.calls.length, 0);

  const badUrl = await submit({ ...event, url: "javascript:alert(1)" }, { ip: "203.0.113.21" });
  assert.equal(badUrl.response.status, 400);
  assert.equal(badUrl.calls.length, 0);
});

test("cross-origin and missing origin are rejected", async () => {
  const cross = await submit(event, { origin: "https://evil.example", ip: "203.0.113.22" });
  assert.equal(cross.response.status, 403);
  assert.equal(cross.calls.length, 0);

  const request = post(event, { ip: "203.0.113.23" });
  request.headers.delete("Origin");
  const response = await route(request, env(), { fetch: async () => { throw new Error("no fetch"); }, cache: memoryCache() });
  assert.equal(response.status, 403);
});

test("rate limit blocks the sixth submission from one address", async () => {
  const cache = memoryCache();
  const mock = githubMock(() => created());
  for (let i = 0; i < 5; i++) {
    const ok = await submit({ ...event, title: `Event number ${i + 10}` }, { cache, ip: "203.0.113.30" }, mock);
    assert.equal(ok.response.status, 200);
  }
  const blocked = await submit({ ...event, title: "Event number 99" }, { cache, ip: "203.0.113.30" }, mock);
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.response.headers.get("Retry-After"), "3600");
  assert.equal(mock.calls.length, 5);

  const other = await submit(sponsor, { cache, ip: "203.0.113.31" }, mock);
  assert.equal(other.response.status, 200);
});

test("missing token or bad repo does not call GitHub", async () => {
  const mock = githubMock(() => created());
  const missing = await route(post(event, { ip: "203.0.113.40" }), {}, { fetch: mock.fetchImpl, cache: memoryCache() });
  assert.equal(missing.status, 503);
  const badRepo = await route(post(event, { ip: "203.0.113.41" }), env({ GITHUB_REPO: "https://evil.example/repo" }), {
    fetch: mock.fetchImpl,
    cache: memoryCache(),
  });
  assert.equal(badRepo.status, 503);
  assert.equal(mock.calls.length, 0);
});

test("creates missing labels, then falls back to an unlabeled issue", async () => {
  let phase = "missing-label";
  const mock = githubMock((call) => {
    if (call.url.endsWith("/labels")) return { status: 403, body: { message: "Resource not accessible" } };
    if (phase === "missing-label") {
      phase = "still-missing";
      return { status: 422, body: { message: "Validation Failed", errors: [{ resource: "Label", field: "labels" }] } };
    }
    if (phase === "still-missing" && call.body.labels) {
      phase = "plain";
      return { status: 422, body: { message: "Label does not exist" } };
    }
    return created(7);
  });
  const { response, calls } = await submit(event, { ip: "203.0.113.50" }, mock);
  assert.equal(response.status, 200);
  assert.equal(calls.at(-1).body.labels, undefined);
  assert.equal(calls.some((call) => call.url.endsWith("/labels")), true);
});

test("GitHub failures stay generic for the visitor", async () => {
  const mock = githubMock(() => ({ status: 401, body: { message: "Bad credentials" } }));
  const { response, json, text } = await submit(event, { ip: "203.0.113.60" }, mock);
  assert.equal(response.status, 502);
  assert.match(json.error, /try again/i);
  assert.doesNotMatch(text, /Bad credentials/);
  assert.doesNotMatch(text, new RegExp(TOKEN));
});

test("a browser form post without JavaScript returns HTML", async () => {
  const { response, text, calls } = await submit(sponsor, {
    ip: "203.0.113.70",
    type: "application/x-www-form-urlencoded",
    accept: "text/html",
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(text, /Thanks/);
  assert.match(text, /href="\/sponsor.html"/);
  assert.equal(calls[0].body.labels[0], "sponsor-inquiry");
});

test("static paths stay on the asset binding and GET is not an issue", async () => {
  let fetched = "";
  const response = await route(new Request("https://cperadar.com/submit.html"), {
    ASSETS: { async fetch(request) { fetched = new URL(request.url).pathname; return new Response("page"); } },
  });
  assert.equal(fetched, "/submit.html");
  assert.equal(await response.text(), "page");

  const method = await route(new Request("https://cperadar.com/api/submissions"), env());
  assert.equal(method.status, 405);
});

test("the public forms no longer short-circuit", () => {
  for (const name of ["submit.html", "sponsor.html"]) {
    const html = readFileSync(new URL(`../site/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(html, /not wired up|placeholder form/);
    assert.match(html, /action="\/api\/submissions"/);
    assert.match(html, /name="hp_field"/);
    assert.match(html, /src="forms\.js"/);
  }
  const submit = readFileSync(new URL("../site/submit.html", import.meta.url), "utf8");
  const sponsor = readFileSync(new URL("../site/sponsor.html", import.meta.url), "utf8");
  for (const name of ["title", "host", "when", "format", "cpe", "url", "email", "kind"]) assert.match(submit, new RegExp(`name="${name}"`));
  for (const name of ["company", "email", "interest", "message", "kind"]) assert.match(sponsor, new RegExp(`name="${name}"`));
});

test("both forms submit through HTTP the way the browser script does", async () => {
  const issues = [];
  const mock = githubMock((call) => created(issues.push(call.body)));
  const cache = memoryCache();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (["host", "connection", "content-length", "transfer-encoding"].includes(key) || value == null) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const body = Buffer.concat(chunks);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await route(request, env(), { fetch: mock.fetchImpl, cache, limit: 10 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const origin = `http://127.0.0.1:${port}`;
    for (const [path, data] of [["/submit-like", event], ["/sponsor-like", sponsor]]) {
      const response = await fetch(`${origin}/api/submissions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Origin: origin,
          "CF-Connecting-IP": `203.0.113.${path.length}`,
        },
        body: JSON.stringify(data),
      });
      const json = await response.json();
      assert.equal(response.status, 200, path);
      assert.equal(json.ok, true);
    }
    assert.equal(issues.length, 2);
    assert.match(issues[0].title, /\[event\]/);
    assert.match(issues[1].title, /\[sponsor\]/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
