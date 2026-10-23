import { handleSubmission } from "./submissions.mjs";

export default {
  async fetch(request, env) {
    return route(request, env);
  },
};

export async function route(request, env, deps) {
  const url = new URL(request.url);
  if (url.pathname === "/api/submissions") return handleSubmission(request, env, deps);
  if (env?.ASSETS?.fetch) return env.ASSETS.fetch(request);
  return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
}
