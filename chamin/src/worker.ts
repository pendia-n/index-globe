import entry from '@tanstack/react-start/server-entry'
import { stripeWebhook } from './teder/payments'
import { tederApi } from './teder/api'
import { accountPages, isWorkspacePath, publicPages } from './teder/paths'
import type { Bindings } from './teder/security'

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/stripe/webhook') return stripeWebhook(request,env)
    if (pathname === '/api/teder') return tederApi(request, env)
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      return new Response('Not found', { status: 404 })
    }
    const response = await entry.fetch(request)
    const pagePath = pathname.replace(/\/+$/, '') || '/'
    const known = pagePath === '/' || accountPages.includes(pagePath) || publicPages.includes(pagePath) || isWorkspacePath(pagePath)
    const secured = new Response(response.body, { headers: response.headers, status: response.ok && !known ? 404 : response.status })
    secured.headers.set('Referrer-Policy', 'no-referrer')
    secured.headers.set('X-Frame-Options', 'DENY')
    secured.headers.set('X-Content-Type-Options', 'nosniff')
    return secured
  },
}
