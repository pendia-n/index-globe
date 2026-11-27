export const publicPages = ['/bunker', '/about', '/pricing', '/announcements', '/terms', '/privacy', '/supply', '/sell', '/access']
export const accountPages = ['/register', '/login', '/recovery']

export function isWorkspacePath(path: string) {
  return ['/workspace', '/workspace/operations', '/workspace/payments', '/workspace/messages', '/workspace/company', '/workspace/power', '/workspace/energy', '/workspace/energy/new', '/workspace/bunkers', '/workspace/inbox', '/workspace/team', '/workspace/review'].includes(path)
    || /^\/workspace\/(?:requests|bunkers|energy|messages)\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(path)
}
