const utf8 = new TextEncoder()
const sessionSeconds = 28 * 86400
export const cookieName = '__Host-teder_session'
export type Bindings = { DB: D1Database; TEDER_JWT_SECRET: string }

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
}
function compare(a: string, b: string) {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}
async function key(secret: string, purpose: string) {
  if (!secret || secret.length < 32) throw new Error('Signing secret missing')
  return crypto.subtle.importKey('raw', utf8.encode(purpose + ':' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
export async function digest(secret: string, purpose: string, value: string) {
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret, purpose), utf8.encode(value))))
}
export function normalizeCode(value: string) {
  return value.replace(/[\s-]/g, '').toLowerCase()
}
export function isRecoveryCode(value: string) { return /^[0-9a-f]{40}$/.test(normalizeCode(value)) }
export async function passwordHash(password: string, secret: string, salt = base64url(crypto.getRandomValues(new Uint8Array(16)))) {
  const peppered = await digest(secret, 'password', password)
  const material = await crypto.subtle.importKey('raw', utf8.encode(peppered), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: utf8.encode(salt), iterations: 100000 }, material, 256)
  return salt + ':' + base64url(new Uint8Array(bits))
}
export async function matchesPassword(password: string, secret: string, hash: string) {
  return compare(await passwordHash(password, secret, hash.split(':')[0]), hash)
}
const header = base64url(utf8.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
type Claims = { iss: string; sub: string; sid: string; ver: number; exp: number }
export async function createSession(env: Bindings, user: { id: string; auth_version: number }) {
  const sid = crypto.randomUUID()
  const exp = Math.floor(Date.now() / 1000) + sessionSeconds
  const claims: Claims = { iss: 'teder', sub: user.id, sid, ver: user.auth_version, exp }
  const signingInput = header + '.' + base64url(utf8.encode(JSON.stringify(claims)))
  const signature = await digest(env.TEDER_JWT_SECRET, 'session', signingInput)
  await env.DB.prepare('INSERT INTO sessions VALUES (?, ?, ?)').bind(sid, user.id, exp).run()
  return cookieName + '=' + signingInput + '.' + signature + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + sessionSeconds
}
export const clearCookie = cookieName + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
export async function readSession(request: Request, env: Bindings): Promise<Claims | null> {
  const token = request.headers.get('cookie')?.split(/;\s*/).find((part) => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
  if (!token || token.length > 1200) return null
  try {
    const [h, payload, signature, extra] = token.split('.')
    if (extra || h !== header || !payload || !signature) return null
    if (!await crypto.subtle.verify('HMAC', await key(env.TEDER_JWT_SECRET, 'session'), decode(signature), utf8.encode(h + '.' + payload))) return null
    const claims = JSON.parse(new TextDecoder().decode(decode(payload))) as Claims
    if (claims.iss !== 'teder' || typeof claims.sub !== 'string' || typeof claims.sid !== 'string' ||
       !Number.isInteger(claims.ver) || !Number.isInteger(claims.exp) || claims.exp <= Date.now() / 1000) return null
    return claims
  } catch { return null }
}
