import { z } from 'zod'
import { clearCookie, createSession, digest, isRecoveryCode, matchesPassword, normalizeCode, passwordHash, readSession } from './security'
import type { Bindings } from './security'

class Failure extends Error { constructor(message: string, public status = 400) { super(message) } }
const text = (max: number) => z.string().trim().min(1).max(max)
const uuid = z.uuid()
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/)
const password = z.string().min(12).max(18).regex(/[a-zA-Z]/).regex(/[0-9]/)
const code = z.string().max(100).refine(isRecoveryCode)
const moment = z.number().int().min(0).max(4102444800000)
const id = () => crypto.randomUUID()
type User = { id: string; username: string; company_id: string; company_name: string; status: string; role: string; reviewer: number; auth_version: number }
type Deal = { id: string; buyer_id: string; seller_id: string; request_id: string; start_at: number; end_at: number; agreement_ref: string | null; buyer_signed_at: number | null; seller_signed_at: number | null; schedule_ref: string | null; current_delivery_id: string | null; delivery_status: string | null }
type Val = string | number | null
function response(data: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  if (cookie) headers.set('Set-Cookie', cookie)
  return Response.json(data, { status, headers })
}
async function quota(env: Bindings, scope: string, value: string, max: number, window: number) {
  const now = Date.now()
  const k = await digest(env.TEDER_JWT_SECRET, 'limits', scope + ':' + value)
  const row = await env.DB.prepare(`INSERT INTO auth_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET
    hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING hits`)
    .bind(k, now + window, now, now).first<{ hits: number }>()
  if ((row?.hits ?? 0) > max) throw new Failure('Too many attempts. Try again later.', 429)
}

export async function tederApi(req: Request, env: Bindings): Promise<Response> {
  try {
    if (req.method !== 'POST') return response({ error: 'Use POST.' }, 405)
    if (req.headers.get('origin') !== new URL(req.url).origin) throw new Failure('Invalid request origin.', 403)
    if (!req.headers.get('content-type')?.startsWith('application/json')) throw new Failure('Send a JSON request.', 415)
    if (Number(req.headers.get('content-length') ?? 0) > 24000) throw new Failure('Request is too large.', 413)
    let body: unknown
    try {
      const raw = await req.text()
      if (raw.length > 24000) throw new Failure('Request is too large.', 413)
      body = JSON.parse(raw)
    } catch (error) {
      if (error instanceof Failure) throw error
      throw new Failure('Invalid request.')
    }
    const { action } = z.object({ action: text(40) }).parse(body)
    const db = env.DB
    const secret = env.TEDER_JWT_SECRET
    const ip = req.headers.get('CF-Connecting-IP') ?? 'local'
    const now = Date.now()
    const statement = (sql: string, ...args: Val[]) => db.prepare(sql).bind(...args)
    const all = async (sql: string, ...args: Val[]) => (await statement(sql, ...args).all()).results
    const changed = async (sql: string, ...args: Val[]) => {
      const r = await statement(sql, ...args).run()
      if (!r.meta.changes) throw new Failure('This record changed or the action is unavailable. Refresh and try again.', 409)
    }
    if (action === 'available') {
      await quota(env, action, ip, 120, 600000)
      const name = z.object({ username }).parse(body).username
      return response({ available: !await statement('SELECT 1 FROM users WHERE username=?', name).first() })
    }
    if (action === 'register') {
      await quota(env, action, ip, 20, 3600000)
      const input = z.object({ username, password, code, recoveryConfirmation: code, saved: z.literal(true), company: z.string().trim().max(120).optional(), registration: z.string().trim().toUpperCase().max(80).optional(), invite: z.string().trim().max(100).optional() }).parse(body)
      if (normalizeCode(input.code) !== normalizeCode(input.recoveryConfirmation)) throw new Failure('Paste the recovery code you copied.')
      const userId = id()
      if (await statement('SELECT id FROM users WHERE username=?', input.username).first()) throw new Failure('That username is taken.', 409)
      const [hashed, recovery] = await Promise.all([passwordHash(input.password, secret), digest(secret, 'recovery', normalizeCode(input.code))])
      try {
        if (input.invite) {
          const invite = await digest(secret, 'invite', input.invite)
          const [result] = await db.batch([
            statement(`INSERT INTO users (id,username,password_hash,recovery_hash,company_id,role)
              SELECT ?,?,?,?,company_id,role FROM staff_invites WHERE hash=? AND used_by IS NULL AND expires_at>?`,
              userId, input.username, hashed, recovery, invite, now),
            statement('UPDATE staff_invites SET used_by=? WHERE hash=? AND used_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE id=?)', userId, invite, userId),
          ])
          if (!result.meta.changes) throw new Failure('This team invitation is invalid or expired.', 409)
        } else {
          if (!input.company || !input.registration) throw new Failure('Enter the company name and registration number.')
          const companyId = id()
          await db.batch([
            statement('INSERT INTO companies (id,name,registration) VALUES (?,?,?)', companyId, input.company, input.registration),
            statement(`INSERT INTO users (id,username,password_hash,recovery_hash,company_id,role) VALUES (?,?,?,?,?,'owner')`, userId, input.username, hashed, recovery, companyId),
          ])
        }
      } catch (error) {
        if (error instanceof Failure) throw error
        if (String(error).includes('UNIQUE constraint')) throw new Failure('That username or company registration is already in use. Ask your company owner for an invitation.', 409)
        throw error
      }
      return response({ ok: true }, 201, await createSession(env, { id: userId, auth_version: 1 }))
    }
    if (action === 'login' || action === 'recover') {
      await quota(env, action + ':ip', ip, 35, 900000)
      const name = z.object({ username }).parse(body).username
      await quota(env, action + ':user', name, 10, 900000)
      const user = await statement('SELECT id,password_hash,recovery_hash,auth_version FROM users WHERE username=?', name)
        .first<{ id: string; password_hash: string; recovery_hash: string; auth_version: number }>()
      if (action === 'login') {
        const value = z.object({ password: z.string().min(1).max(128) }).parse(body).password
        const ok = user ? await matchesPassword(value, secret, user.password_hash) : (await passwordHash(value, secret), false)
        if (!ok || !user) throw new Failure('Username or password is incorrect.', 401)
        return response({ ok: true }, 200, await createSession(env, user))
      }
      const input = z.object({ oldCode: code, password, code, recoveryConfirmation: code, saved: z.literal(true) }).parse(body)
      if (normalizeCode(input.code) !== normalizeCode(input.recoveryConfirmation) || normalizeCode(input.code) === normalizeCode(input.oldCode)) throw new Failure('Copy and confirm a new recovery code.')
      const prior = await digest(secret, 'recovery', normalizeCode(input.oldCode))
      if (!user) throw new Failure('Username or recovery code is incorrect.', 401)
      const [hashed, replacement] = await Promise.all([passwordHash(input.password, secret), digest(secret, 'recovery', normalizeCode(input.code))])
      const result = await statement('UPDATE users SET password_hash=?, recovery_hash=?, auth_version=auth_version+1 WHERE id=? AND recovery_hash=?',
        hashed, replacement, user.id, prior).run()
      if (!result.meta.changes) throw new Failure('Username or recovery code is incorrect.', 401)
      return response({ ok: true }, 200, clearCookie)
    }
    const claims = await readSession(req, env)
    const user = claims && await statement(`SELECT u.id,u.username,u.company_id,u.role,u.reviewer,u.auth_version,c.name company_name,c.status
      FROM users u JOIN companies c ON c.id=u.company_id JOIN sessions s ON s.user_id=u.id
      WHERE u.id=? AND s.id=? AND u.auth_version=? AND s.expires_at>?`,
      claims.sub, claims.sid, claims.ver, Math.floor(now / 1000)).first<User>()
    if (action === 'session') return response({ user: user || null })
    if (!user || !claims) throw new Failure('Sign in to continue.', 401)
    const org = user.company_id
    if (action === 'logout') {
      await statement('DELETE FROM sessions WHERE id=? AND user_id=?', claims.sid, user.id).run()
      return response({ ok: true }, 200, clearCookie)
    }
    if (action === 'reviewList' || action === 'review') {
      if (!user.reviewer) throw new Failure('Reviewer access required.', 403)
      if (action === 'reviewList') return response({ companies: await all('SELECT * FROM companies WHERE id<>? ORDER BY status,name LIMIT 200', org) })
      const input = z.object({ companyId: uuid, result: z.enum(['approved','rejected']), note: text(500) }).parse(body)
      await changed('UPDATE companies SET status=?,reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND id<>?',
        input.result, user.id, now, input.note, input.companyId, org)
      return response({ ok: true })
    }
    if (action === 'invite') {
      if (user.role !== 'owner') throw new Failure('Only the company owner can invite staff.', 403)
      const role = z.object({ role: z.enum(['trader','operator','viewer']) }).parse(body).role
      const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), v => v.toString(16).padStart(2, '0')).join('')
      await statement('INSERT INTO staff_invites (hash,company_id,role,expires_at) VALUES (?,?,?,?)',
        await digest(secret, 'invite', token), org, role, now + 86400000).run()
      return response({ link: new URL('/register?invite=' + token, req.url).href })
    }
    if (action === 'overview') return response({
      user,
      requests: await all(`SELECT r.*,b.name buyer_name,s.name seller_name,d.id deal_id FROM requests r
        JOIN companies b ON b.id=r.buyer_id JOIN companies s ON s.id=r.seller_id LEFT JOIN deals d ON d.request_id=r.id
        WHERE r.buyer_id=? OR r.seller_id=? ORDER BY r.created_at DESC LIMIT 250`, org, org),
    })
    if (action === 'detail') {
      const input = z.object({ requestId: uuid }).parse(body)
      const request = await statement(`SELECT r.*,b.name buyer_name,s.name seller_name FROM requests r
        JOIN companies b ON b.id=r.buyer_id JOIN companies s ON s.id=r.seller_id
        WHERE r.id=? AND (r.buyer_id=? OR r.seller_id=?)`, input.requestId, org, org).first()
      if (!request) throw new Failure('Request not found.', 404)
      const deal = await statement('SELECT * FROM deals WHERE request_id=?', input.requestId).first<{ id: string }>()
      return response({
        request, deal,
        offers: await all('SELECT o.*,u.username FROM offers o JOIN users u ON u.id=o.actor_id WHERE request_id=? ORDER BY revision DESC', input.requestId),
        deliveries: deal ? await all('SELECT * FROM deliveries WHERE deal_id=? ORDER BY reported_at DESC', deal.id) : [],
        events: deal ? await all('SELECT e.*,u.username FROM deal_events e JOIN users u ON u.id=e.actor_id WHERE deal_id=? ORDER BY occurred_at', deal.id) : [],
      })
    }
    if (user.status !== 'approved' || user.role === 'viewer') throw new Failure('An approved company and trading access are required.', 403)
    const trader = () => { if (user.role !== 'owner' && user.role !== 'trader') throw new Failure('Trader access required.', 403) }
    const owner = () => { if (user.role !== 'owner') throw new Failure('Only the company owner can authorize this action.', 403) }
    const operator = () => { if (user.role !== 'owner' && user.role !== 'operator') throw new Failure('Operator access required.', 403) }
    if (action === 'request') {
      trader()
      const input = z.object({ seller: username, point: text(120), requirements: text(1700), startAt: moment, endAt: moment, closesAt: moment, kw: z.number().int().positive().max(1000000) }).parse(body)
      if (!(now < input.closesAt && input.closesAt <= input.startAt && input.startAt < input.endAt) ||
          input.endAt - input.startAt > 30 * 86400000 ||
          input.startAt % 1800000 || input.endAt % 1800000) throw new Failure('Use a future deadline and a delivery window on half-hour boundaries.')
      const seller = await statement(`SELECT c.id FROM users u JOIN companies c ON c.id=u.company_id WHERE u.username=? AND u.role='owner' AND c.status='approved' AND c.id<>?`, input.seller, org).first<{ id: string }>()
      if (!seller) throw new Failure('Enter a different approved supplier company owner’s username.', 404)
      const requestId = id()
      await statement('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?,?)', requestId, org, seller.id, user.id, input.point, input.startAt, input.endAt, input.closesAt, input.kw, input.requirements, now).run()
      return response({ requestId }, 201)
    }
    if (action === 'offer') {
      trader()
      const i = z.object({ requestId: uuid, kind: z.enum(['firm','indicative','counter']), priceCents: z.number().int().positive().max(1000000000), terms: text(1700), expiresAt: moment, expected: z.number().int().min(0) }).parse(body)
      if (i.expiresAt <= now) throw new Failure('Enter a future offer expiry.')
      await changed(`INSERT INTO offers (id,request_id,revision,actor_id,kind,price_cents,terms,expires_at,created_at)
        SELECT ?,r.id,?+1,?,?,?,?,?,? FROM requests r JOIN companies b ON b.id=r.buyer_id JOIN companies s ON s.id=r.seller_id
        WHERE r.id=? AND r.closes_at>? AND r.closes_at>=? AND b.status='approved' AND s.status='approved'
        AND CASE WHEN ?='counter' THEN r.buyer_id=? AND ?>0 ELSE r.seller_id=? END
        AND NOT EXISTS(SELECT 1 FROM deals WHERE request_id=r.id)
        AND coalesce((SELECT max(revision) FROM offers WHERE request_id=r.id),0)=?`,
        id(), i.expected, user.id, i.kind, i.priceCents, i.terms, i.expiresAt, now,
        i.requestId, now, i.expiresAt, i.kind, org, i.expected, org, i.expected)
      return response({ ok: true })
    }
    if (action === 'award') {
      owner()
      const offerId = z.object({ offerId: uuid }).parse(body).offerId
      await changed(`INSERT INTO deals (id,request_id,offer_id,selected_by,selected_at)
        SELECT ?,r.id,o.id,?,? FROM offers o JOIN requests r ON r.id=o.request_id JOIN companies s ON s.id=r.seller_id
        WHERE o.id=? AND r.buyer_id=? AND s.status='approved' AND o.kind='firm' AND o.expires_at>? AND r.closes_at>?
        AND o.revision=(SELECT max(revision) FROM offers WHERE request_id=r.id)
        ON CONFLICT(request_id) DO NOTHING`, id(), user.id, now, offerId, org, now, now)
      return response({ ok: true })
    }

    const dealId = z.object({ dealId: uuid }).parse(body).dealId
    const deal = await statement(`SELECT d.*,r.buyer_id,r.seller_id,r.start_at,r.end_at FROM deals d JOIN requests r ON r.id=d.request_id
      WHERE d.id=? AND (r.buyer_id=? OR r.seller_id=?)`, dealId, org, org).first<Deal>()
    if (!deal) throw new Failure('Deal not found.', 404)
    const buyer = org === deal.buyer_id
    const record = (kind: string, detail: string) => statement(`INSERT INTO deal_events
      SELECT ?,?,?,?,?,? WHERE changes()=1`, id(), deal.id, user.id, kind, detail, now)
    const transition = async (sql: string, args: Val[], kind: string, detail: string) => {
      const [result] = await db.batch([statement(sql, ...args), record(kind, detail)])
      if (!result.meta.changes) throw new Failure('This deal changed. Refresh before continuing.', 409)
    }
    if (action === 'sign') {
      owner()
      const ref = z.object({ reference: text(300), attested: z.literal(true) }).parse(body).reference
      const side = buyer ? 'buyer' : 'seller'
      await transition(`UPDATE deals SET agreement_ref=?, ${side}_signed_by=?, ${side}_signed_at=? WHERE id=?
        AND ${side}_signed_at IS NULL AND (agreement_ref IS NULL OR agreement_ref=?)`,
        [ref, user.id, now, deal.id, ref], side + ' acknowledged agreement', ref)
    } else if (action === 'schedule') {
      operator()
      if (buyer || !deal.buyer_signed_at || !deal.seller_signed_at) throw new Failure('The seller can record a schedule after both sides acknowledge the signed agreement.', 403)
      const i = z.object({ reference: text(300), issuer: text(120) }).parse(body)
      await transition('UPDATE deals SET schedule_ref=?, scheduler_name=?, scheduled_by=?, scheduled_at=? WHERE id=? AND current_delivery_id IS NULL',
        [i.reference, i.issuer, user.id, now, deal.id], 'schedule recorded', i.issuer + ' · ' + i.reference)
    } else if (action === 'delivery') {
      operator()
      if (buyer || !deal.schedule_ref || now < deal.end_at) throw new Failure('The seller can report delivery after the scheduled window ends.', 403)
      const i = z.object({ reference: text(300), issuer: text(120), wh: z.number().int().min(0).max(1e12), previous: uuid.nullable() }).parse(body)
      const entry = id()
      const results = await db.batch([
        statement(`INSERT INTO deliveries SELECT ?,id,?,?,?,?,? FROM deals WHERE id=? AND schedule_ref IS NOT NULL
          AND current_delivery_id IS ? AND (delivery_status IS NULL OR delivery_status='disputed')`,
          entry, user.id, i.issuer, i.reference, i.wh, now, deal.id, i.previous),
        statement(`UPDATE deals SET current_delivery_id=?,delivery_status='reported',review_note=NULL,reviewed_by=NULL,reviewed_at=NULL WHERE id=?
          AND EXISTS(SELECT 1 FROM deliveries WHERE id=?)`, entry, deal.id, entry),
        record('delivery reported', i.issuer + ' · ' + i.reference),
      ])
      if (!results[0].meta.changes) throw new Failure('The delivery record changed or must be disputed before correction.', 409)
    } else if (action === 'deliveryReview') {
      operator()
      if (!buyer) throw new Failure('Only the buyer can review delivery.', 403)
      const i = z.object({ deliveryId: uuid, result: z.enum(['reconciled','disputed']), note: text(1200) }).parse(body)
      await transition(`UPDATE deals SET delivery_status=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=? AND current_delivery_id=? AND delivery_status='reported'`,
        [i.result, i.note, user.id, now, deal.id, i.deliveryId], 'delivery ' + i.result, i.note)
    } else if (action === 'settlement') {
      operator()
      if (!buyer) throw new Failure('Only the buyer can record external settlement.', 403)
      const ref = z.object({ reference: text(300) }).parse(body).reference
      await transition(`UPDATE deals SET settlement_ref=?,settled_by=?,settled_at=? WHERE id=? AND delivery_status='reconciled' AND settlement_ref IS NULL`,
        [ref, user.id, now, deal.id], 'external settlement recorded', ref)
    } else { throw new Failure('Unknown action.', 404) }
    return response({ ok: true })
  } catch (error) {
    if (error instanceof Failure) return response({ error: error.message }, error.status)
    if (error instanceof z.ZodError) return response({ error: 'Check the displayed values and try again.' }, 400)
    console.error('Teder request failed', error instanceof Error ? error.name : 'UnknownError')
    return response({ error: 'We could not complete that request. Try again.' }, 500)
  }
}
