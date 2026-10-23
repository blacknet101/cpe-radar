import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const OCT23_241PM_PDT = Date.parse("2026-10-23T21:41:00Z");

function loadApp() {
  const code = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "site/app.js" });
  assert.equal(typeof sandbox.visibleEvents, "function");
  assert.equal(typeof sandbox.renderEvent, "function");
  return sandbox;
}

const { visibleEvents, renderEvent } = loadApp();

function ev(overrides) {
  return {
    title: "Example webinar",
    host: "Example Host",
    start: "2026-10-27T15:00:00+00:00",
    format: "Webinar",
    certs: ["CISSP", "CISM"],
    auto_submit: false,
    duration_min: 60,
    cpe: 1,
    cpe_estimate: true,
    url: "https://example.com/event",
    ...overrides,
  };
}

// The three sessions at the top of the Oct 23 screenshot, plus the next real one.
const screenshotList = [
  ev({
    title: "Workshop: Job Hunt Like a Hacker – 2026 Edition",
    host: "Antisyphon Training / Black Hills InfoSec",
    start: "2026-10-20T14:00:00+00:00",
    format: "Workshop",
    certs: ["CISSP", "CISM", "Security+", "CySA+", "GIAC"],
    duration_min: 390,
    cpe: 6.5,
    url: "https://www.antisyphontraining.com/event/workshop-job-hunt-like-a-hacker-2026-edition-5/",
  }),
  ev({
    title: "Beyond PKI: Redefining Digital Trust for the PQC Era",
    host: "Thales - Cybersecurity Solutions",
    start: "2026-10-21T13:00:00+00:00",
    url: "https://example.com/pki",
  }),
  ev({
    title: "Attack Breakdown – How It Actually Happens.  Episode 3:  When MFA isn't enough: OAuth abuse and token theft",
    host: "OpenText - Cybersecurity",
    start: "2026-10-21T14:00:00+00:00",
    duration_min: 30,
    cpe: 0.5,
    url: "https://example.com/oauth",
  }),
  ev({
    title: "Beyond Users and Workloads: The Agentic Shift in Cloud-Native Zero Trust",
    host: "ISC2",
    start: "2026-10-27T15:00:00+00:00",
    certs: ["CISSP", "CCSP", "SSCP"],
    auto_submit: true,
    url: "https://example.com/agentic",
  }),
];

test("default list drops events whose start time has already passed", () => {
  const shown = visibleEvents(screenshotList, { now: OCT23_241PM_PDT });
  assert.deepEqual(shown.map((event) => event.title), [
    "Beyond Users and Workloads: The Agentic Shift in Cloud-Native Zero Trust",
  ]);
});

test("an event starting this instant stays; one millisecond earlier does not", () => {
  const now = Date.parse("2026-10-27T15:00:00Z");
  const atNow = ev({ start: new Date(now).toISOString() });
  const justBefore = ev({ start: new Date(now - 1).toISOString(), title: "Already started" });
  assert.deepEqual(visibleEvents([justBefore, atNow], { now }).map((event) => event.title), ["Example webinar"]);
});

test("a later US evening stays listed when its timestamp is already the next UTC date", () => {
  // 5:30 PM PDT on Oct 23 is 00:30 UTC on Oct 24. 7:00 PM PDT is 02:00 UTC.
  const now = Date.parse("2026-10-24T00:30:00Z");
  const tonight = ev({ title: "Evening brief", start: "2026-10-24T02:00:00Z" });
  const yesterday = ev({ title: "Yesterday", start: "2026-10-23T14:00:00Z" });
  assert.deepEqual(
    visibleEvents([yesterday, tonight], { now }).map((event) => event.title),
    ["Evening brief"],
  );
});

test("unparseable start times are omitted", () => {
  assert.deepEqual(visibleEvents([ev({ start: "not-a-date" }), ev()], { now: OCT23_241PM_PDT }).length, 1);
});

test("search, cert, format, and auto-submit still apply, including to past matches", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  const events = [
    ev({ title: "Alpha lab", host: "Antisyphon", certs: ["GIAC"], format: "Workshop", auto_submit: false, start: "2026-10-20T14:00:00Z" }),
    ev({ title: "Beta brief", host: "ISC2", certs: ["CISSP", "CCSP"], format: "Webinar", auto_submit: true, start: "2026-10-27T15:00:00Z" }),
    ev({ title: "Gamma summit", host: "SANS Institute", certs: ["CISSP", "GIAC"], format: "Virtual Summit", auto_submit: false, start: "2026-11-10T15:30:00Z" }),
  ];

  assert.deepEqual(visibleEvents(events, { now, q: "beta" }).map((event) => event.title), ["Beta brief"]);
  assert.deepEqual(visibleEvents(events, { now, q: "ISC2" }).map((event) => event.title), ["Beta brief"]);
  assert.deepEqual(visibleEvents(events, { now, q: "alpha" }).map((event) => event.title), ["Alpha lab"]);
  assert.deepEqual(visibleEvents(events, { now: OCT23_241PM_PDT, q: "alpha" }).map((event) => event.title), []);

  assert.deepEqual(visibleEvents(events, { now, cert: "GIAC" }).map((event) => event.title), ["Alpha lab", "Gamma summit"]);
  assert.deepEqual(visibleEvents(events, { now, cert: "CCSP" }).map((event) => event.title), ["Beta brief"]);
  assert.deepEqual(visibleEvents(events, { now, format: "Virtual Summit" }).map((event) => event.title), ["Gamma summit"]);
  assert.deepEqual(visibleEvents(events, { now, format: "Workshop" }).map((event) => event.title), ["Alpha lab"]);
  assert.deepEqual(visibleEvents(events, { now, autoOnly: true }).map((event) => event.title), ["Beta brief"]);
  assert.equal(visibleEvents(events, { now, autoOnly: false }).length, 3);

  const combined = visibleEvents(events, { now, q: "brief", cert: "CISSP", format: "Webinar", autoOnly: true });
  assert.deepEqual(combined.map((event) => event.title), ["Beta brief"]);
});

test("Next N days is a window from now and no longer includes events that already started", () => {
  const now = Date.parse("2026-10-23T21:41:00Z");
  const past = ev({ title: "Past", start: "2026-10-21T14:00:00Z" });
  const inside = ev({ title: "Inside", start: new Date(now + 6 * 86_400_000).toISOString() });
  const justInside = ev({ title: "Just inside", start: new Date(now + 7 * 86_400_000 - 1).toISOString() });
  const boundary = ev({ title: "Boundary", start: new Date(now + 7 * 86_400_000).toISOString() });
  const outside = ev({ title: "Outside", start: new Date(now + 8 * 86_400_000).toISOString() });
  const events = [past, inside, justInside, boundary, outside];

  assert.deepEqual(
    visibleEvents(events, { now, withinDays: 7 }).map((event) => event.title),
    ["Inside", "Just inside"],
  );
  assert.deepEqual(
    visibleEvents(events, { now, withinDays: 0 }).map((event) => event.title),
    ["Inside", "Just inside", "Boundary", "Outside"],
  );
  assert.equal(visibleEvents(events, { now }).length, 4);
});

test("the event count is the number of events that pass every filter", () => {
  const shown = visibleEvents(screenshotList, { now: OCT23_241PM_PDT, cert: "SSCP", autoOnly: true });
  assert.equal(shown.length, 1);
  assert.equal(`${shown.length} free events`, "1 free events");
});

test("cards still render the start in the viewer's local zone", () => {
  const script = `
    import vm from "node:vm";
    import { readFileSync } from "node:fs";
    const code = readFileSync("site/app.js", "utf8");
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: "site/app.js" });
    const html = sandbox.renderEvent({
      title: "Beyond Users and Workloads",
      host: "ISC2",
      start: "2026-10-27T15:00:00+00:00",
      format: "Webinar",
      certs: ["CISSP"],
      auto_submit: true,
      duration_min: 60,
      cpe: 1,
      cpe_estimate: true,
      url: "https://example.com/agentic",
    });
    if (!html.includes("Oct 27")) process.exit(2);
    if (!html.includes("8:00 AM PDT")) process.exit(3);
    if (!html.includes("auto-submit")) process.exit(4);
    if (!html.includes(">Beyond Users and Workloads</a>")) process.exit(5);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, TZ: "America/Los_Angeles", LANG: "en_US.UTF-8" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("renderEvent is available to the page and boot does not run without a document", () => {
  assert.match(renderEvent(ev({ title: "Keep <title>", cpe_estimate: false })), /CPE<\/small>/);
  assert.doesNotMatch(renderEvent(ev({ cpe_estimate: false })), /est\./);
  const html = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  for (const id of ["q", "cert", "fmt", "when", "auto", "count", "list", "gen"]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(app, new RegExp(`["']${id}["']`));
  }
  assert.match(html, /<script src="app\.js"><\/script>/);
  assert.match(html, /Any date/);
  assert.match(html, /Next 7 days/);
  assert.match(html, /Next 30 days/);
  assert.match(html, /Next 90 days/);
  assert.match(html, /Auto-submit only/);
});
