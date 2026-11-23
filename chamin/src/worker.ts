import entry from '@tanstack/react-start/server-entry'
import { tederApi } from './teder/api'
import type { Bindings } from './teder/security'

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/teder') return tederApi(request, env)
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      return new Response('Not found', { status: 404 })
    }
    const response = await entry.fetch(request)
    const secured = new Response(response.body, response)
    secured.headers.set('Referrer-Policy', 'no-referrer')
    secured.headers.set('X-Frame-Options', 'DENY')
    secured.headers.set('X-Content-Type-Options', 'nosniff')
    return secured
  },
}
