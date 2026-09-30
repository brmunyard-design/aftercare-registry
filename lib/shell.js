// Serves a static HTML shell for a bearer-link route such as /s/<token> or /c/<token>.
import { SECURITY_HEADERS } from './util.js';

export async function serveShell(request, env, page) {
  const asset = await env.ASSETS.fetch(new Request(new URL(page, request.url)));
  const headers = new Headers(asset.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set('cache-control', 'no-store');
  return new Response(asset.body, { status: asset.status, headers });
}
