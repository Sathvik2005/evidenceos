// Vercel Function entry: every /api/* request is handled by the framework-agnostic API.
import { waitUntil } from '@vercel/functions'
import { getApp } from '../frontend/src/server/app'

async function handler(request: Request): Promise<Response> {
  try {
    return await getApp(process.env, waitUntil).handle(request)
  } catch {
    // Misconfiguration (e.g. DATABASE_URL missing): say so without echoing any value.
    return new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'The server is not configured correctly.' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

export { handler as GET, handler as POST }
