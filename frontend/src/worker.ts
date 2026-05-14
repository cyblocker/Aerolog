export interface Env {
  BACKEND: { fetch: (req: Request) => Promise<Response> };
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Proxy requests starting with /api/ or /admin/api/ to the backend service binding
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/api/')) {
      if (env.BACKEND) {
        return env.BACKEND.fetch(request);
      }
      return new Response('Backend binding not found', { status: 500 });
    }

    // Serving mapping/assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    // If we are in Vite dev mode (via @cloudflare/vite-plugin) and ASSETS is missing,
    // we might need to just return nothing and let Vite handle it, but worker.ts fetch must return a Response.
    // However, the crash was specifically on calling .fetch() of undefined.
    return new Response('Asset not handled by worker', { status: 404 });
  },
};
