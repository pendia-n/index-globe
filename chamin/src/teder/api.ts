import { energyApi } from './energy-api'
import { brokerAccess } from './bunker-brokers'
import { hashOperatorInvitation } from './operator-identity'
import { bunkerFees } from './bunker-fees'
import { bunkerDocuments, maxDocumentBytes } from './bunker-documents'
import { applyBunkerFulfilment } from './bunker-fulfilment'
import { z } from 'zod'
import { clearCookie, createSession, digest, isRecoveryCode, matchesPassword, normalizeCode, passwordHash, readSession } from './security'
import type { Bindings } from './security'
import { findRegistry, registryNumber, seatLimit, supportsJurisdiction } from './registries'
import { sources } from './products'

class Failure extends Error { constructor(message: string, public status = 400) { super(message) } }
const text = (max: number) => z.string().trim().min(1).max(max)
const uuid = z.uuid()
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/)
const password = z.string().min(12).max(18).regex(/[a-zA-Z]/).regex(/[0-9]/)
const code = z.string().max(100).refine(isRecoveryCode)
const moment = z.number().int().min(0).max(4102444800000)
const id = () => crypto.randomUUID()
type User = { id: string; username: string; company_id: string; company_name: string; status: string; role: string; workspace_kind: string; bunker_operator: number; auth_version: number }
type Deal = { id: string; buyer_id: string; seller_id: string; request_id: string; start_at: number; end_at: number; agreement_ref: string | null; buyer_signed_at: number | null; seller_signed_at: number | null; schedule_ref: string | null; current_delivery_id: string | null; delivery_status: string | null; kw: number }
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
    const documentUpload = new URL(req.url).searchParams.get('upload') === 'bunker-document'
    const maxBodyBytes = documentUpload ? maxDocumentBytes / 3 * 4 + 4096 : 24000
    if (Number(req.headers.get('content-length') ?? 0) > maxBodyBytes) throw new Failure('Request is too large.', 413)
    let body: unknown
    try {
      const reader = req.body?.getReader()
      if (!reader) throw new Failure('A JSON body is required.')
      const decoder = new TextDecoder()
      let received = 0
      let raw = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > maxBodyBytes) {
          await reader.cancel()
          throw new Failure('Request is too large.', 413)
        }
        raw += decoder.decode(value, { stream:true })
      }
      body = JSON.parse(raw + decoder.decode())
    } catch (error) {
      if (error instanceof Failure) throw error
      throw new Failure('Invalid request.')
    }
    const { action } = z.object({ action: text(40) }).parse(body)
    if (documentUpload !== (action === 'bunkerUpload')) throw new Failure('Invalid upload endpoint.')
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
    if (action === 'bunkerPorts') {
      return response({ ports: await all(`SELECT p.code,p.name,p.time_zone,p.active requested_active,
        CASE WHEN p.active=1 AND EXISTS(SELECT 1 FROM bunker_supplier_eligibility s JOIN companies c ON c.id=s.company_id
          WHERE s.port_code=p.code AND s.revoked_at IS NULL AND s.valid_until>? AND c.status='approved') THEN 1 ELSE 0 END active
        FROM bunker_ports p ORDER BY name`,now) })
    }
    if (action === 'bunkerSubmit') {
      await quota(env, action, ip, 12, 3600000)
      const input = z.object({
        requestKey: uuid, company: text(120), email: z.email().max(254),
        port: text(5), grade: z.enum(['VLSFO', 'MGO']),
        quantityKg: z.number().int().positive().max(50000000),
        arrivalAt: moment, endAt: moment,
      }).parse(body)
      if (input.arrivalAt <= now || input.endAt <= input.arrivalAt) {
        throw new Failure('Enter a future delivery window with an end after the start.')
      }
      if (!await statement('SELECT 1 FROM bunker_ports WHERE code=?', input.port).first()) {
        throw new Failure('Choose a delivery port.')
      }
      await statement(`INSERT INTO bunker_enquiries
        (id,request_key,company_name,work_email,port_code,grade,quantity_kg,arrival_at,end_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(request_key) DO NOTHING`,
        id(), input.requestKey, input.company, input.email, input.port, input.grade, input.quantityKg,
        input.arrivalAt, input.endAt, now).run()
      return response({ receipt: input.requestKey }, 201)
    }
    if (action === 'bunkerTrack') {
      await quota(env, action, ip, 90, 600000)
      const { receipt } = z.object({ receipt: uuid }).parse(body)
      const enquiry = await statement(`SELECT CASE
        WHEN cancelled_at IS NOT NULL THEN 'cancelled'
        WHEN declined_at IS NOT NULL THEN 'declined'
        WHEN buyer_company_id IS NOT NULL THEN 'assigned'
        ELSE 'checking' END status
        FROM bunker_enquiries WHERE request_key=?`, receipt).first()
      if (!enquiry) throw new Failure('Receipt not found.', 404)
      return response(enquiry)
    }
    if (action === 'available') {
      await quota(env, action, ip, 120, 600000)
      const name = z.object({ username }).parse(body).username
      return response({ available: !await statement('SELECT 1 FROM users WHERE username=?', name).first() })
    }
    if (action === 'register') {
      await quota(env, action, ip, 20, 3600000)
      const input = z.object({ username, password, code, recoveryConfirmation: code, saved: z.literal(true), company: z.string().trim().max(120).optional(), registration: z.string().trim().max(80).optional(), country: z.string().max(2).optional(), registryRegion: z.string().max(3).optional(), invite: z.string().trim().max(100).optional(), operatorInvite: z.string().regex(/^[a-f0-9]{64}$/).optional(), issuingRegistry: z.string().trim().max(120).optional() }).parse(body)
      if (normalizeCode(input.code) !== normalizeCode(input.recoveryConfirmation)) throw new Failure('Paste the recovery code you copied.')
      if (input.username.startsWith('ops-') && !input.operatorInvite) throw new Failure('Choose a customer username without the ops- prefix.')
      const userId = id()
      if (await statement('SELECT id FROM users WHERE username=?', input.username).first()) throw new Failure('That username is taken.', 409)
      const [hashed, recovery] = await Promise.all([passwordHash(input.password, secret), digest(secret, 'recovery', normalizeCode(input.code))])
      try {
        if (input.operatorInvite) {
          const token = await hashOperatorInvitation(input.operatorInvite)
          const companyId = id()
          const [claim] = await db.batch([
            statement(`INSERT INTO companies (id,name,registration,workspace_kind)
              SELECT ?,'Teder Operations',?,'operations' FROM bunker_operator_invites
              WHERE token_hash=? AND username=? AND used_by IS NULL AND expires_at>?`,
              companyId, 'ops:' + companyId, token, input.username, now),
            statement(`INSERT INTO users (id,username,password_hash,recovery_hash,company_id,role)
              SELECT ?,?,?,?,id,'owner' FROM companies WHERE id=?`, userId,input.username,hashed,recovery,companyId),
            statement(`UPDATE bunker_operator_invites SET used_by=? WHERE token_hash=? AND EXISTS (SELECT 1 FROM users WHERE id=?)`,
              userId,token,userId),
            statement(`INSERT INTO bunker_operators (user_id,granted_at) SELECT id,? FROM users WHERE id=?`, now,userId),
            statement(`INSERT INTO bunker_operator_events SELECT ?,id,'activated',? FROM users WHERE id=?`, id(),now,userId),
          ])
          if (!claim.meta.changes) throw new Failure('This operator invitation is unavailable. Check the username and request a current invitation.', 409)
        } else if (input.invite) {
          const invite = await digest(secret, 'invite', input.invite)
          const [result] = await db.batch([
            statement(`INSERT INTO users (id,username,password_hash,recovery_hash,company_id,role)
              SELECT ?,?,?,?,company_id,role FROM staff_invites i WHERE hash=? AND used_by IS NULL AND expires_at>?
              AND (SELECT count(*) FROM users WHERE company_id=i.company_id AND disabled_at IS NULL)<?`,
              userId, input.username, hashed, recovery, invite, now, seatLimit),
            statement('UPDATE staff_invites SET used_by=? WHERE hash=? AND used_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE id=?)', userId, invite, userId),
          ])
          if (!result.meta.changes) throw new Failure('This invitation is unavailable. Ask the company owner for a current link and available seat.', 409)
        } else {
          const country = input.country ?? ''
          const region = input.registryRegion ?? ''
          const registry = findRegistry(country)
          const number = registryNumber(country, input.registration ?? '')
          if (!input.company || !supportsJurisdiction(country)) throw new Failure('Enter the legal company name and select a supported registration jurisdiction.')
          if (registry?.regions.length ? !registry.regions.some(([code]) => code === region) : region !== '') {
            throw new Failure('Choose the correct issuing jurisdiction.')
          }
          if (registry ? !registry.pattern.test(number) : !number || !input.issuingRegistry) throw new Failure('Check the registered company identifier.')
          const companyId = id()
          await db.batch([
            statement('INSERT INTO companies (id,name,registration,country,registry_region,registry_number,issuing_registry) VALUES (?,?,?,?,?,?,?)',
              companyId, input.company, 'registry:' + companyId, country,
              registry ? region : input.issuingRegistry!.toUpperCase().replace(/\s+/g,' '), number, input.issuingRegistry ?? null),
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
      const user = await statement('SELECT id,password_hash,recovery_hash,auth_version FROM users WHERE username=? AND disabled_at IS NULL', name)
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
    const user = claims && await statement(`SELECT u.id,u.username,u.company_id,u.role,u.auth_version,c.workspace_kind, CASE WHEN c.workspace_kind='operations' AND EXISTS (SELECT 1 FROM bunker_operators o WHERE o.user_id=u.id AND o.revoked_at IS NULL) THEN 1 ELSE 0 END bunker_operator,c.name company_name,c.status
      FROM users u JOIN companies c ON c.id=u.company_id JOIN sessions s ON s.user_id=u.id
      WHERE u.id=? AND s.id=? AND u.auth_version=? AND s.expires_at>? AND u.disabled_at IS NULL`,
      claims.sub, claims.sid, claims.ver, Math.floor(now / 1000)).first<User>()
    if (action === 'session') return response({ user: user ? { ...user, reviewer: user.bunker_operator } : null })
    if (!user || !claims) throw new Failure('Sign in to continue.', 401)
    if (action.startsWith('energy')) return energyApi(action, body, env, user)
    const org = user.company_id
    if (action === 'logout') {
      await statement('DELETE FROM sessions WHERE id=? AND user_id=?', claims.sid, user.id).run()
      return response({ ok: true }, 200, clearCookie)
    }
    if (action === 'tradeInbox' || action === 'tradeInboxRead') {
      const visibility = '(n.company_id=? OR n.user_id=? OR (n.operations=1 AND ?=1))'
      const visibilityArgs: Val[] = [org,user.id,user.bunker_operator]
      const views = ['trade_notice_1','trade_notice_2','trade_notice_3','trade_notice_4','trade_notice_5','trade_notice_6']
      if (action === 'tradeInboxRead') {
        const { notificationId } = z.object({ notificationId:text(150) }).parse(body)
        await db.batch(views.map(view => statement(`INSERT INTO trade_notification_reads (user_id,notification_id,read_at)
          SELECT ?,n.id,? FROM ${view} n WHERE n.id=? AND ${visibility}
          ON CONFLICT DO NOTHING`,user.id,now,notificationId,...visibilityArgs)))
        return response({ok:true})
      }
      const results = await db.batch<{id:string; occurred_at:number; read_at:number|null}>(views.map(view => statement(
        `SELECT n.id,n.kind,n.href,n.occurred_at,r.read_at FROM ${view} n
         LEFT JOIN trade_notification_reads r ON r.notification_id=n.id AND r.user_id=?
         WHERE ${visibility} AND n.occurred_at>? ORDER BY r.read_at IS NOT NULL,n.occurred_at DESC,n.id DESC LIMIT 100`,
        user.id,...visibilityArgs,now-90*86400000)))
      const notifications = results.flatMap(result => result.results).sort((a,b) =>
        Number(!!a.read_at)-Number(!!b.read_at) || b.occurred_at-a.occurred_at || b.id.localeCompare(a.id))
      return response({notifications:notifications.slice(0,100)})
    }
    if (action === 'bunkerEnquiries') {
      return response({ enquiries: await all(`SELECT e.id,e.company_name,
        CASE WHEN ?=1 THEN e.work_email END work_email,
        p.name port,e.grade,e.quantity_kg,e.arrival_at,e.end_at,e.buyer_company_id,e.declined_at,e.assigned_by,e.cancelled_at
        FROM bunker_enquiries e JOIN bunker_ports p ON p.code=e.port_code
        WHERE e.buyer_company_id=? OR ?=1 OR EXISTS (SELECT 1 FROM bunker_invitations i WHERE i.enquiry_id=e.id AND i.supplier_id=?) OR ${brokerAccess('e')} ORDER BY e.created_at DESC LIMIT 100`,
        user.bunker_operator, org, user.bunker_operator, org, org, now) })
    }
    if (action === 'bunkerAssign' || action === 'bunkerDecline') {
      if (!user.bunker_operator) throw new Failure('Teder operations access required.', 403)
      const operatorCheck = 'EXISTS (SELECT 1 FROM bunker_operators WHERE user_id=? AND revoked_at IS NULL)'
      if (action === 'bunkerDecline') {
        const { enquiryId } = z.object({ enquiryId: uuid }).parse(body)
        await changed(`UPDATE bunker_enquiries SET declined_at=?,assigned_by=?
          WHERE id=? AND buyer_company_id IS NULL AND declined_at IS NULL AND ${operatorCheck}`,
          now, user.id, enquiryId, user.id)
      } else {
        const input = z.object({ enquiryId: uuid, buyer: username }).parse(body)
        const buyer = await statement(`SELECT company_id FROM users
          WHERE username=? AND role='owner' AND disabled_at IS NULL AND company_id<>?`, input.buyer, org).first<{ company_id: string }>()
        if (!buyer) throw new Failure('Enter the username of a buyer workspace owner.', 404)
        await changed(`UPDATE bunker_enquiries SET buyer_company_id=?,assigned_by=?,assigned_at=?
          WHERE id=? AND buyer_company_id IS NULL AND declined_at IS NULL AND ${operatorCheck}`,
          buyer.company_id, user.id, now, input.enquiryId, user.id)
      }
      return response({ ok: true })
    }
    if (action === 'bunkerCoverageAdmin') {
      if (!user.bunker_operator) throw new Failure('Teder operations access required.', 403)
      return response({
        eligibility: await all(`SELECT x.*,c.name,c.status FROM (
          SELECT 'supplier' kind,port_code,company_id,licence_reference reference,valid_until,revoked_at FROM bunker_supplier_eligibility
          UNION ALL SELECT 'broker',port_code,company_id,authority_reference,valid_until,revoked_at FROM bunker_broker_eligibility
        ) x JOIN companies c ON c.id=x.company_id ORDER BY x.port_code,x.kind,c.name LIMIT 500`),
        activity: await all(`SELECT e.id,e.port_code,c.name,e.action,e.note,e.occurred_at
          FROM bunker_eligibility_events e LEFT JOIN companies c ON c.id=e.company_id ORDER BY occurred_at DESC LIMIT 60`),
      })
    }
    if (action === 'bunkerCoverage') {
      if (!user.bunker_operator) throw new Failure('Teder operations access required.', 403)
      const input = z.object({ port: text(5), enabled: z.boolean(), note: text(500).optional() }).parse(body)
      const [result] = await db.batch([
        statement(`UPDATE bunker_ports SET active=? WHERE code=? AND EXISTS
          (SELECT 1 FROM bunker_operators WHERE user_id=? AND revoked_at IS NULL)
          AND (?=0 OR EXISTS(SELECT 1 FROM bunker_supplier_eligibility s JOIN companies c ON c.id=s.company_id
            WHERE s.port_code=bunker_ports.code AND s.valid_until>? AND s.revoked_at IS NULL AND c.status='approved'))`,
          Number(input.enabled), input.port, user.id, Number(input.enabled), now),
        statement(`INSERT INTO bunker_eligibility_events SELECT ?,?,NULL,?,?,?,? WHERE changes()=1`,
          id(),input.port,user.id,input.enabled?'port-enabled':'port-paused',input.note ?? 'Adjusted quoting availability',now),
      ])
      if (!result.meta.changes) throw new Failure('A port needs a currently eligible supplier before it can open for quotes.',409)
      return response({ ok: true })
    }
    if (['bunkerApproveSupplier','bunkerApproveBroker','bunkerRevokeEligibility'].includes(action)) {
      if (!user.bunker_operator) throw new Failure('Teder operations access required.', 403)
      const revoke = action === 'bunkerRevokeEligibility'
      const kind = revoke ? z.object({kind:z.enum(['supplier','broker'])}).parse(body).kind :
        action === 'bunkerApproveSupplier' ? 'supplier' : 'broker'
      const table = kind === 'supplier' ? 'bunker_supplier_eligibility' : 'bunker_broker_eligibility'
      if (revoke) {
        const i = z.object({ port:text(5), company:uuid, note:text(500) }).parse(body)
        const [result] = await db.batch([
          statement(`UPDATE ${table} SET revoked_at=?,valid_until=MIN(valid_until,?) WHERE port_code=? AND company_id=? AND revoked_at IS NULL
            AND EXISTS (SELECT 1 FROM bunker_operators WHERE user_id=? AND revoked_at IS NULL)`,now,now,i.port,i.company,user.id),
          statement(`INSERT INTO bunker_eligibility_events SELECT ?,?,?,?,?,?,? WHERE changes()=1`,id(),i.port,i.company,user.id,kind+'-revoked',i.note,now),
        ])
        if (!result.meta.changes) throw new Failure('Eligibility was already removed or no longer exists.',409)
      } else {
        const i = z.object({ port:text(5), supplier:username.optional(), broker:username.optional(),
          licence:text(200).optional(), authority:text(300).optional(), validUntil:moment }).parse(body)
        const name = kind==='supplier'?i.supplier:i.broker
        const reference = kind==='supplier'?i.licence:i.authority
        if (!name || !reference || i.validUntil <= now) throw new Failure('Enter a verified authority reference and a future expiry.')
        const column = kind==='supplier'?'licence_reference':'authority_reference'
        const company = await statement(`SELECT c.id FROM users u JOIN companies c ON c.id=u.company_id
          WHERE u.username=? AND u.role='owner' AND u.disabled_at IS NULL AND c.status='approved' AND c.workspace_kind='customer'`,
          name).first<{id:string}>()
        if (!company) throw new Failure('Choose an approved customer workspace owner.',404)
        const [result] = await db.batch([
          statement(`INSERT INTO ${table} (port_code,company_id,${column},valid_until,approved_by)
            SELECT p.code,c.id,?,?,? FROM bunker_ports p JOIN companies c ON c.id=? AND c.status='approved'
            WHERE p.code=? AND EXISTS (SELECT 1 FROM bunker_operators WHERE user_id=? AND revoked_at IS NULL)
            ON CONFLICT(port_code,company_id) DO UPDATE SET ${column}=excluded.${column},
              valid_until=excluded.valid_until,approved_by=excluded.approved_by,revoked_at=NULL`,
            reference,i.validUntil,user.id,company.id,i.port,user.id),
          statement(`INSERT INTO bunker_eligibility_events SELECT ?,?,?,?,?,?,? WHERE changes()=1`,
            id(),i.port,company.id,user.id,kind+'-approved',reference,now),
        ])
        if (!result.meta.changes) throw new Failure('Eligibility could not be recorded for this port.',409)
      }
      return response({ok:true})
    }
    if (action === 'bunkerAppointBroker' || action === 'bunkerRevokeBroker') {
      if (user.status !== 'approved' || user.role !== 'owner') throw new Failure('Buyer owner approval required.',403)
      const { enquiryId } = z.object({ enquiryId:uuid }).parse(body)
      const note = z.object({ note:text(600) }).parse(body).note
      const assign = action === 'bunkerAppointBroker'
      const mutation = assign ? statement(`INSERT INTO bunker_broker_assignments (enquiry_id,broker_company_id,assigned_by,assigned_at,revoked_at)
        SELECT e.id,b.company_id,?,?,NULL FROM bunker_enquiries e JOIN bunker_broker_eligibility b ON b.port_code=e.port_code
        JOIN companies c ON c.id=b.company_id WHERE e.id=? AND e.buyer_company_id=? AND b.company_id=?
        AND b.company_id<>e.buyer_company_id AND b.valid_until>=e.end_at AND c.status='approved'
        AND NOT EXISTS(SELECT 1 FROM bunker_invitations i WHERE i.enquiry_id=e.id AND i.supplier_id=b.company_id)
        ON CONFLICT(enquiry_id) DO UPDATE SET broker_company_id=excluded.broker_company_id,
          assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at,revoked_at=NULL
        WHERE bunker_broker_assignments.revoked_at IS NOT NULL`,
        user.id,now,enquiryId,org,z.object({ brokerId:uuid }).parse(body).brokerId) :
        statement(`UPDATE bunker_broker_assignments SET revoked_at=? WHERE enquiry_id=? AND revoked_at IS NULL AND
          EXISTS (SELECT 1 FROM bunker_enquiries WHERE id=? AND buyer_company_id=?)`,now,enquiryId,enquiryId,org)
      const [result] = await db.batch([mutation, statement(`INSERT INTO bunker_broker_activity
        SELECT ?,enquiry_id,broker_company_id,?,?,?,? FROM bunker_broker_assignments WHERE enquiry_id=? AND changes()=1`,
        id(),user.id,assign?'assigned':'revoked',note,now,enquiryId)])
      if (!result.meta.changes) throw new Failure('Broker assignment is unavailable. Revoke any current assignment before appointing another broker.',409)
      return response({ ok:true })
    }
    if (action === 'bunkerBrokerNote') {
      if (user.status !== 'approved' || !['owner','trader','operator'].includes(user.role)) throw new Failure('Approved workspace access required.',403)
      const i = z.object({ enquiryId:uuid, note:text(1000) }).parse(body)
      await changed(`INSERT INTO bunker_broker_activity
        SELECT ?,e.id,a.broker_company_id,?,'note',?,? FROM bunker_enquiries e JOIN bunker_broker_assignments a ON a.enquiry_id=e.id
        WHERE e.id=? AND a.revoked_at IS NULL AND (e.buyer_company_id=? OR ${brokerAccess('e')})`,
        id(),user.id,i.note,now,i.enquiryId,org,org,now)
      return response({ ok:true })
    }
    if (['bunkerFee','bunkerFeeIssue','bunkerFeeReport','bunkerFeeReceive'].includes(action)) {
      return await bunkerFees(db, user, action, body, now)
    }
    if (action === 'bunkerDocuments' || action === 'bunkerDownload' || action === 'bunkerUpload') {
      if (action === 'bunkerUpload') {
        if (user.status !== 'approved' || !['owner','operator'].includes(user.role)) {
          throw new Failure('Approved operations access required.', 403)
        }
        await quota(env, action, user.id, 40, 3600000)
      }
      return await bunkerDocuments(db, user, action, body, now)
    }
    if (action === 'bunkerFulfil') {
      if (user.status !== 'approved' || !['owner','operator'].includes(user.role)) {
        throw new Failure('Approved operations access required.', 403)
      }
      return await applyBunkerFulfilment(db, user, body, now)
    }
    if (action === 'bunkerDetail') {
      const { enquiryId } = z.object({ enquiryId: uuid }).parse(body)
      const enquiry = await statement(`SELECT e.id,e.company_name,e.grade,e.quantity_kg,e.arrival_at,e.end_at,e.vessel,e.imo,
        e.specification,e.buyer_company_id,e.assigned_by,e.revision,e.cancelled_at,e.cancellation_note,p.name port,
        CASE WHEN p.active=1 AND EXISTS(SELECT 1 FROM bunker_supplier_eligibility se JOIN companies ce ON ce.id=se.company_id
          WHERE se.port_code=p.code AND se.revoked_at IS NULL AND se.valid_until>=e.end_at AND ce.status='approved') THEN 1 ELSE 0 END active,
        ${brokerAccess('e')} is_broker
        FROM bunker_enquiries e JOIN bunker_ports p ON p.code=e.port_code WHERE e.id=? AND
        (e.buyer_company_id=? OR (e.assigned_by=? AND ?=1) OR EXISTS (SELECT 1 FROM bunker_invitations WHERE enquiry_id=e.id AND supplier_id=?) OR ${brokerAccess('e')})`,
        org, now, enquiryId, org, user.id, user.bunker_operator, org, org, now).first<{ buyer_company_id: string; assigned_by: string; is_broker: number }>()
      if (!enquiry) throw new Failure('Request not found.', 404)
      const buyer = enquiry.buyer_company_id === org
      const coordinator = !!user.bunker_operator && enquiry.assigned_by === user.id
      const fulfilments = await all(`SELECT f.* FROM bunker_fulfilment f JOIN bunker_orders o ON o.id=f.order_id
        JOIN bunker_quotes q ON q.id=o.quote_id WHERE o.enquiry_id=? AND (?=1 OR q.supplier_id=?)`,
        enquiryId, Number(buyer || coordinator), org)
      const fulfilmentEvents = await all(`SELECT x.order_id,x.revision,x.event,x.details,x.created_at
        FROM bunker_fulfilment_events x JOIN bunker_orders o ON o.id=x.order_id JOIN bunker_quotes q ON q.id=o.quote_id
        WHERE o.enquiry_id=? AND (?=1 OR q.supplier_id=?) ORDER BY x.revision`, enquiryId, Number(buyer || coordinator), org)
      const broker = !!enquiry.is_broker
      const assignment = buyer || broker ? await statement(`SELECT a.broker_company_id,c.name
        FROM bunker_broker_assignments a JOIN companies c ON c.id=a.broker_company_id
        WHERE a.enquiry_id=? AND a.revoked_at IS NULL`,enquiryId).first() : null
      return response({ enquiry, buyer, coordinator, broker, assignment, fulfilments, fulfilmentEvents,
        changes: await all(`SELECT id,event,enquiry_revision,previous_terms,reason,occurred_at FROM bunker_request_changes
          WHERE enquiry_id=? ORDER BY enquiry_revision DESC,occurred_at DESC LIMIT 50`,enquiryId),
        brokerCandidates: buyer ? await all(`SELECT c.id,c.name FROM bunker_enquiries e
          JOIN bunker_broker_eligibility b ON b.port_code=e.port_code JOIN companies c ON c.id=b.company_id
          WHERE e.id=? AND c.id<>e.buyer_company_id AND c.status='approved' AND b.valid_until>=e.end_at
          AND NOT EXISTS (SELECT 1 FROM bunker_invitations i WHERE i.enquiry_id=e.id AND i.supplier_id=c.id)
          ORDER BY c.name LIMIT 100`,enquiryId) : [],
        brokerActivity: buyer || broker ? await all(`SELECT event,note,occurred_at FROM bunker_broker_activity
          WHERE enquiry_id=? AND (?=1 OR broker_company_id=?) ORDER BY occurred_at DESC LIMIT 50`,enquiryId,Number(buyer),org) : [],
        eligible: buyer || broker ? await all(`SELECT c.id,c.name FROM bunker_enquiries e JOIN bunker_supplier_eligibility s ON s.port_code=e.port_code
          JOIN companies c ON c.id=s.company_id WHERE e.id=? AND c.id<>e.buyer_company_id AND c.status='approved' AND s.valid_until>=e.end_at
          AND NOT EXISTS(SELECT 1 FROM bunker_broker_assignments a WHERE a.enquiry_id=e.id AND a.broker_company_id=c.id AND a.revoked_at IS NULL)
          ORDER BY c.name LIMIT 100`, enquiryId) : [],
        invitations: await all(`SELECT i.supplier_id,c.name FROM bunker_invitations i JOIN companies c ON c.id=i.supplier_id
          WHERE i.enquiry_id=? AND (?=1 OR i.supplier_id=?) ORDER BY c.name`, enquiryId, Number(buyer || coordinator || broker), org),
        quotes: await all(`SELECT * FROM bunker_quotes WHERE enquiry_id=? AND (?=1 OR supplier_id=?) ORDER BY revision DESC`, enquiryId, Number(buyer || coordinator || broker), org),
        orders: await all(`SELECT o.*,f.cancelled_at FROM bunker_orders o JOIN bunker_quotes q ON q.id=o.quote_id
          LEFT JOIN bunker_fulfilment f ON f.order_id=o.id WHERE o.enquiry_id=? AND (?=1 OR q.supplier_id=?) ORDER BY o.selected_at DESC`, enquiryId, Number(buyer || coordinator || broker), org),
      })
    }
    if (action === 'bunkerReviseRequest' || action === 'bunkerCancelRequest') {
      if (user.role !== 'owner' || user.status !== 'approved') throw new Failure('Approved buyer owner access required.',403)
      const input = z.object({ enquiryId:uuid, revision:z.number().int().positive(), reason:text(500) }).parse(body)
      const scope = `id=? AND buyer_company_id=? AND revision=? AND cancelled_at IS NULL AND declined_at IS NULL
        AND EXISTS(SELECT 1 FROM users u JOIN companies c ON c.id=u.company_id
          WHERE u.id=? AND c.id=bunker_enquiries.buyer_company_id AND u.role='owner' AND u.disabled_at IS NULL AND c.status='approved')
        AND NOT EXISTS(SELECT 1 FROM bunker_orders o WHERE o.enquiry_id=bunker_enquiries.id AND o.status IN ('selected','confirmed'))`
      const args = [input.enquiryId,org,input.revision,user.id]
      const previous = await statement(`SELECT vessel,imo,specification,grade,quantity_kg,arrival_at,end_at FROM bunker_enquiries WHERE ${scope}`,...args).first()
      if (!previous) throw new Failure('Refresh the request. Withdraw an active selection before changing terms.',409)
      const revise = action === 'bunkerReviseRequest'
      let mutation: D1PreparedStatement
      if (revise) {
        const next = z.object({ vessel:text(120),imo:z.string().regex(/^\d{7}$/),specification:text(1700),
          grade:z.enum(['VLSFO','MGO']),quantityKg:z.number().int().positive().max(50000000),arrivalAt:moment,endAt:moment }).parse(body)
        if (next.arrivalAt<=now || next.endAt<=next.arrivalAt) throw new Failure('Enter a future delivery window with an end after the start.')
        mutation = statement(`UPDATE bunker_enquiries SET vessel=?,imo=?,specification=?,grade=?,quantity_kg=?,arrival_at=?,end_at=?,
          revision=revision+1 WHERE ${scope}`,
          next.vessel,next.imo,next.specification,next.grade,next.quantityKg,next.arrivalAt,next.endAt,...args)
      } else {
        mutation = statement(`UPDATE bunker_enquiries SET cancelled_at=?,cancellation_note=? WHERE ${scope}`,now,input.reason,...args)
      }
      const [result] = await db.batch([mutation, statement(`INSERT INTO bunker_request_changes
        SELECT ?,?,?,?,?,?,?,? WHERE changes()=1`,id(),input.enquiryId,user.id,revise?'revised':'cancelled',
        revise?input.revision+1:input.revision,JSON.stringify(previous),input.reason,now)])
      if (!result.meta.changes) throw new Failure('The request changed before your update. Refresh and try again.',409)
      return response({ok:true})
    }
    if (['bunkerPrepare','bunkerInvite','bunkerQuote','bunkerSelect','bunkerRespond'].includes(action)) {
      if (user.status !== 'approved' || !['owner','trader'].includes(user.role)) {
        throw new Failure('Approved trading access required.', 403)
      }
      if (action === 'bunkerPrepare') {
        const i = z.object({ enquiryId: uuid, vessel: text(120), imo: z.string().regex(/^\d{7}$/), specification: text(1700) }).parse(body)
        await changed(`UPDATE bunker_enquiries AS e SET vessel=?,imo=?,specification=? WHERE id=? AND (buyer_company_id=? OR ${brokerAccess('e')})
          AND cancelled_at IS NULL AND revision=1 AND arrival_at>? AND NOT EXISTS (SELECT 1 FROM bunker_invitations WHERE enquiry_id=e.id)`,
          i.vessel, i.imo, i.specification, i.enquiryId, org, org, now, now)
      }
      if (action === 'bunkerInvite') {
        const i = z.object({ enquiryId: uuid, supplierId: uuid }).parse(body)
        await changed(`INSERT INTO bunker_invitations (enquiry_id,supplier_id,invited_at)
          SELECT e.id,s.company_id,? FROM bunker_enquiries e JOIN bunker_ports p ON p.code=e.port_code
          JOIN bunker_supplier_eligibility s ON s.port_code=e.port_code JOIN companies c ON c.id=s.company_id
          WHERE e.id=? AND e.cancelled_at IS NULL AND (e.buyer_company_id=? OR ${brokerAccess('e')}) AND e.vessel IS NOT NULL AND e.arrival_at>? AND p.active=1
          AND s.company_id=? AND s.company_id<>e.buyer_company_id AND s.valid_until>=e.end_at AND c.status='approved'
          AND NOT EXISTS(SELECT 1 FROM bunker_orders o WHERE o.enquiry_id=e.id AND o.status IN ('selected','confirmed'))
          AND NOT EXISTS(SELECT 1 FROM bunker_broker_assignments a WHERE a.enquiry_id=e.id AND a.broker_company_id=s.company_id AND a.revoked_at IS NULL)
          ON CONFLICT DO NOTHING`, now, i.enquiryId, org, org, now, now, i.supplierId)
      }
      if (action === 'bunkerQuote') {
        const i = z.object({ enquiryId: uuid, supplierId: uuid, revision: z.number().int().nonnegative(), enquiryRevision:z.number().int().positive(), kind: z.enum(['firm','indicative','counter']),
          price: z.number().int().positive().max(10000000), extras: z.number().int().min(0).max(1000000000), terms: text(1700), expiresAt: moment }).parse(body)
        if (i.expiresAt <= now) throw new Failure('Quote expiry must be in the future.')
        await changed(`INSERT INTO bunker_quotes
          SELECT ?,e.id,i.supplier_id,?+1,?,?,?,?,?,?,?,e.revision FROM bunker_invitations i JOIN bunker_enquiries e ON e.id=i.enquiry_id
          JOIN bunker_ports p ON p.code=e.port_code JOIN bunker_supplier_eligibility s ON s.port_code=e.port_code AND s.company_id=i.supplier_id
          JOIN companies c ON c.id=i.supplier_id JOIN companies b ON b.id=e.buyer_company_id
          WHERE e.id=? AND i.supplier_id=? AND e.revision=? AND e.cancelled_at IS NULL AND p.active=1 AND s.valid_until>=e.end_at AND c.status='approved' AND b.status='approved'
          AND e.arrival_at>=? AND CASE WHEN ?='counter' THEN e.buyer_company_id=? AND EXISTS(
            SELECT 1 FROM bunker_quotes prior WHERE prior.enquiry_id=e.id AND prior.supplier_id=i.supplier_id
            AND prior.revision=? AND prior.enquiry_revision=e.revision AND prior.kind<>'counter')
            ELSE i.supplier_id=? END
          AND NOT EXISTS(SELECT 1 FROM bunker_orders o WHERE o.enquiry_id=e.id AND o.status IN ('selected','confirmed'))
          AND COALESCE((SELECT MAX(revision) FROM bunker_quotes WHERE enquiry_id=e.id AND supplier_id=i.supplier_id),0)=?`,
          id(), i.revision, i.kind, i.price, i.extras, i.terms, i.expiresAt, user.id, now,
          i.enquiryId, i.supplierId, i.enquiryRevision, i.expiresAt, i.kind, org, i.revision, org, i.revision)
      }
      if (action === 'bunkerSelect') {
        if (user.role !== 'owner') throw new Failure('Buyer owner approval required.', 403)
        const i = z.object({ quoteId: uuid }).parse(body)
        await changed(`INSERT INTO bunker_orders (id,enquiry_id,quote_id,selected_by,selected_at,status)
          SELECT ?,e.id,q.id,?,?,'selected' FROM bunker_quotes q JOIN bunker_enquiries e ON e.id=q.enquiry_id
          JOIN bunker_ports p ON p.code=e.port_code JOIN bunker_supplier_eligibility s ON s.port_code=e.port_code AND s.company_id=q.supplier_id
          JOIN companies c ON c.id=q.supplier_id WHERE q.id=? AND e.buyer_company_id=? AND c.status='approved' AND e.cancelled_at IS NULL AND q.enquiry_revision=e.revision
          AND p.active=1 AND s.valid_until>=e.end_at AND q.kind='firm' AND q.expires_at>? AND e.arrival_at>?
          AND q.revision=(SELECT MAX(revision) FROM bunker_quotes WHERE enquiry_id=e.id AND supplier_id=q.supplier_id)
          ON CONFLICT DO NOTHING`, id(), user.id, now, i.quoteId, org, now, now)
      }
      if (action === 'bunkerRespond') {
        if (user.role !== 'owner') throw new Failure('Workspace owner approval required.', 403)
        const i = z.object({ orderId: uuid, result: z.enum(['confirmed','declined','withdrawn']), reference: text(300) }).parse(body)
        await changed(`UPDATE bunker_orders SET status=?,responded_by=?,responded_at=?,response_reference=?
          WHERE id=? AND status='selected' AND EXISTS (
            SELECT 1 FROM bunker_quotes q JOIN bunker_enquiries e ON e.id=q.enquiry_id
            JOIN bunker_ports p ON p.code=e.port_code JOIN bunker_supplier_eligibility s ON s.port_code=e.port_code AND s.company_id=q.supplier_id
            JOIN companies b ON b.id=e.buyer_company_id JOIN companies c ON c.id=q.supplier_id WHERE q.id=bunker_orders.quote_id
            AND CASE WHEN ?='withdrawn' THEN e.buyer_company_id=? ELSE q.supplier_id=? END
            AND (?<>'confirmed' OR (e.cancelled_at IS NULL AND q.enquiry_revision=e.revision AND p.active=1 AND s.valid_until>=e.end_at AND q.expires_at>? AND e.arrival_at>?
              AND b.status='approved' AND c.status='approved')))`,
          i.result, user.id, now, i.reference, i.orderId, i.result, org, org, i.result, now, now)
      }
      return response({ ok: true })
    }
    if (action === 'companyApplication') {
      return response({ applications: await all(`SELECT contact_email,registry_reference,authority_reference,submitted_at,decision,decision_note,decided_at
        FROM company_applications WHERE company_id=? ORDER BY submitted_at DESC LIMIT 20`, org) })
    }
    if (action === 'submitCompanyApplication') {
      if (user.role !== 'owner' || user.workspace_kind !== 'customer') throw new Failure('Customer workspace owner access required.',403)
      const input = z.object({ email:z.email().max(254), registry:text(500), authority:text(500) }).parse(body)
      const [inserted] = await db.batch([
        statement(`INSERT INTO company_applications (id,company_id,contact_email,registry_reference,authority_reference,submitted_by,submitted_at)
          SELECT ?,id,?,?,?,?,? FROM companies WHERE id=? AND workspace_kind='customer' AND status<>'approved'
          ON CONFLICT DO NOTHING`, id(),input.email,input.registry,input.authority,user.id,now,org),
        statement(`UPDATE companies SET status='pending' WHERE id=? AND changes()=1`,org),
      ])
      if (!inserted.meta.changes) throw new Failure('An application is already pending or your company is approved.',409)
      return response({ ok:true })
    }
    if (action === 'reviewList' || action === 'review') {
      if (!user.bunker_operator) throw new Failure('Reviewer access required.', 403)
      if (action === 'reviewList') return response({ companies: await all(`SELECT c.id,c.name,c.country,c.registry_region,c.registry_number,
        c.issuing_registry,c.registration,c.status,c.review_note,a.id application_id,a.contact_email,a.registry_reference,a.authority_reference
        FROM company_applications a JOIN companies c ON c.id=a.company_id WHERE a.decision IS NULL
        ORDER BY a.submitted_at LIMIT 200`) })
      const input = z.object({ companyId:uuid, applicationId:uuid, result:z.enum(['approved','rejected']), note:text(500) }).parse(body)
      const [decision] = await db.batch([
        statement(`UPDATE company_applications SET decision=?,decision_note=?,decided_by=?,decided_at=?
          WHERE id=? AND company_id=? AND decision IS NULL AND EXISTS (SELECT 1 FROM bunker_operators WHERE user_id=? AND revoked_at IS NULL)`,
          input.result,input.note,user.id,now,input.applicationId,input.companyId,user.id),
        statement(`UPDATE companies SET status=?,reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND changes()=1`,
          input.result,user.id,now,input.note,input.companyId),
      ])
      if (!decision.meta.changes) throw new Failure('This application was already decided or is no longer available.',409)
      return response({ ok:true })
    }
    if (action === 'team') return response({
      members: await all(`SELECT username,role,disabled_at FROM users WHERE company_id=? AND (disabled_at IS NULL OR ?=1)
        ORDER BY disabled_at IS NOT NULL,role<>'owner',username`, org, Number(user.role==='owner')),
      invites: user.role === 'owner' ? await all('SELECT invite_id,role,expires_at FROM staff_invites WHERE company_id=? AND expires_at>? AND used_by IS NULL ORDER BY expires_at', org, now) : [],
      transfer: await statement(`SELECT t.id,u.username,t.expires_at FROM team_transfers t JOIN users u ON u.id=t.next_owner_id
        WHERE t.company_id=? AND t.finished_at IS NULL AND t.expires_at>? AND (t.owner_id=? OR t.next_owner_id=?)`,org,now,user.id,user.id).first(),
      activity: user.role === 'owner' ? await all(`SELECT e.id,m.username,a.username actor,e.action,e.role,e.occurred_at
        FROM team_access_events e JOIN users m ON m.id=e.member_id JOIN users a ON a.id=e.actor_id
        WHERE e.company_id=? ORDER BY e.occurred_at DESC LIMIT 50`,org) : [],
      seatLimit,
    })
    if (action === 'teamMember') {
      if (user.role !== 'owner' || user.workspace_kind !== 'customer') throw new Failure('Company owner access required.',403)
      const input = z.discriminatedUnion('operation', [
        z.object({ operation:z.literal('role'), member:username, role:z.enum(['trader','operator','viewer']) }),
        z.object({ operation:z.enum(['remove','restore']), member:username }),
      ]).parse(body)
      const member = await statement("SELECT id,role FROM users WHERE username=? AND company_id=? AND role<>'owner'",input.member,org)
        .first<{id:string; role:string}>()
      if (!member) throw new Failure('Teammate not found.',404)
      const guard = `id=? AND role<>'owner' AND EXISTS(SELECT 1 FROM users WHERE id=? AND company_id=? AND role='owner' AND disabled_at IS NULL)`
      const mutation = input.operation === 'role' ?
        statement(`UPDATE users SET role=? WHERE ${guard} AND disabled_at IS NULL AND role<>?`,input.role,member.id,user.id,org,input.role) :
        input.operation === 'remove' ?
          statement(`UPDATE users SET disabled_at=? WHERE ${guard} AND disabled_at IS NULL`,now,member.id,user.id,org) :
          statement(`UPDATE users SET disabled_at=NULL WHERE ${guard} AND disabled_at IS NOT NULL AND
            (SELECT count(*) FROM users WHERE company_id=? AND disabled_at IS NULL)
            +(SELECT count(*) FROM staff_invites WHERE company_id=? AND used_by IS NULL AND expires_at>?)<?`,
            member.id,user.id,org,org,org,now,seatLimit)
      const [result] = await db.batch([mutation,statement(`INSERT INTO team_access_events
        SELECT ?,?,?,?,?,?,? WHERE changes()=1`,id(),org,member.id,user.id,input.operation,input.operation==='role'?input.role:member.role,now)])
      if (!result.meta.changes) throw new Failure('The teammate or available seats changed. Refresh and check company access.',409)
      return response({ok:true})
    }
    if (action === 'teamTransferStart' || action === 'teamTransferEnd') {
      if (user.workspace_kind !== 'customer') throw new Failure('Company workspace access required.',403)
      if (action === 'teamTransferStart') {
        if (user.role !== 'owner') throw new Failure('Company owner access required.',403)
        const {member} = z.object({member:username}).parse(body)
        const [_, result] = await db.batch([
          statement(`UPDATE team_transfers SET finished_at=?,outcome='cancelled'
            WHERE company_id=? AND finished_at IS NULL AND expires_at<=?`,now,org,now),
          statement(`INSERT INTO team_transfers (id,company_id,owner_id,next_owner_id,created_at,expires_at)
            SELECT ?,c.company_id,o.id,c.id,?,? FROM users c JOIN users o ON o.company_id=c.company_id
            WHERE c.username=? AND c.company_id=? AND c.id<>o.id AND c.disabled_at IS NULL AND c.role<>'owner'
            AND o.id=? AND o.role='owner' AND o.disabled_at IS NULL ON CONFLICT DO NOTHING`,
            id(),now,now+86400000,member,org,user.id),
        ])
        if (!result.meta.changes) throw new Failure('Select an active teammate or cancel the existing request first.',409)
      } else {
        const input = z.object({transferId:uuid, result:z.enum(['accepted','cancelled'])}).parse(body)
        await changed(`UPDATE team_transfers SET finished_at=?,outcome=? WHERE id=? AND company_id=? AND finished_at IS NULL
          AND CASE WHEN ?='cancelled' THEN owner_id=? OR next_owner_id=? ELSE next_owner_id=? AND expires_at>?
            AND EXISTS(SELECT 1 FROM users u WHERE u.id=owner_id AND u.role='owner' AND u.disabled_at IS NULL)
            AND EXISTS(SELECT 1 FROM users u WHERE u.id=next_owner_id AND u.role<>'owner' AND u.disabled_at IS NULL) END`,
          now,input.result,input.transferId,org,input.result,user.id,user.id,user.id,now)
      }
      return response({ok:true})
    }
    if (action === 'invite' || action === 'revokeInvite') {
      if (user.workspace_kind !== 'customer') throw new Failure('Operations access is provisioned separately.', 403)
      if (user.role !== 'owner') throw new Failure('Only the company owner can manage invitations.', 403)
      if (action === 'revokeInvite') {
        const { inviteId } = z.object({ inviteId: z.string().regex(/^[a-f0-9-]{32,36}$/) }).parse(body)
        await changed("UPDATE staff_invites SET expires_at=? WHERE company_id=? AND invite_id=? AND expires_at>? AND used_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE id=? AND role='owner' AND disabled_at IS NULL)", now, org, inviteId, now,user.id)
        return response({ ok: true })
      }
      const role = z.object({ role: z.enum(['trader','operator','viewer']) }).parse(body).role
      const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), v => v.toString(16).padStart(2, '0')).join('')
      const result = await statement(`INSERT INTO staff_invites (hash,company_id,role,expires_at,invite_id)
        SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM users WHERE company_id=? AND disabled_at IS NULL) +
          (SELECT count(*) FROM staff_invites WHERE company_id=? AND used_by IS NULL AND expires_at>?) < ?
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND role='owner' AND disabled_at IS NULL)`,
        await digest(secret, 'invite', token), org, role, now + 86400000, id(), org, org, now, seatLimit,user.id).run()
      if (!result.meta.changes) throw new Failure('All five company seats are occupied or reserved by invitations.', 409)
      return response({ link: new URL('/register?invite=' + token, req.url).href })
    }
    if (action === 'overview') return response({
      user,
      requests: await all(`SELECT r.*,b.name buyer_name,s.name seller_name,d.id deal_id,t.tender_id,t.source,
        CASE WHEN r.buyer_id=? AND t.tender_id IS NOT NULL THEN
          (SELECT count(*) FROM tender_requests WHERE tender_id=t.tender_id) ELSE 1 END supplier_count,
        CASE WHEN t.tender_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM tender_requests siblings JOIN deals awarded ON awarded.request_id=siblings.request_id
          WHERE siblings.tender_id=t.tender_id) THEN 1 ELSE 0 END tender_closed
        FROM requests r JOIN companies b ON b.id=r.buyer_id JOIN companies s ON s.id=r.seller_id
        LEFT JOIN deals d ON d.request_id=r.id LEFT JOIN tender_requests t ON t.request_id=r.id
        WHERE r.buyer_id=? OR r.seller_id=? ORDER BY r.created_at DESC, d.id IS NULL, r.id LIMIT 250`, org, org, org),
    })
    if (action === 'detail') {
      const input = z.object({ requestId: uuid }).parse(body)
      const request = await statement(`SELECT r.*,b.name buyer_name,s.name seller_name,t.tender_id,t.source,
        CASE WHEN t.tender_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM tender_requests siblings JOIN deals awarded ON awarded.request_id=siblings.request_id
          WHERE siblings.tender_id=t.tender_id) THEN 1 ELSE 0 END tender_closed
        FROM requests r JOIN companies b ON b.id=r.buyer_id JOIN companies s ON s.id=r.seller_id
        LEFT JOIN tender_requests t ON t.request_id=r.id
        WHERE r.id=? AND (r.buyer_id=? OR r.seller_id=?)`, input.requestId, org, org)
        .first<{ buyer_id: string; tender_id: string | null }>()
      if (!request) throw new Failure('Request not found.', 404)
      const deal = await statement('SELECT * FROM deals WHERE request_id=?', input.requestId).first<{ id: string }>()
      const comparison = request.buyer_id === org && request.tender_id ? await all(`SELECT r.id request_id,s.name seller_name,
        s.status seller_status,d.id deal_id,o.id offer_id,o.kind,o.price_cents,o.expires_at,o.terms
        FROM tender_requests t JOIN requests r ON r.id=t.request_id JOIN companies s ON s.id=r.seller_id
        LEFT JOIN deals d ON d.request_id=r.id
        LEFT JOIN offers o ON o.request_id=r.id AND o.revision=(SELECT max(revision) FROM offers WHERE request_id=r.id)
        WHERE t.tender_id=? AND r.buyer_id=? ORDER BY s.name,r.id`, request.tender_id, org) : []
      return response({
        request, deal, comparison,
        offers: await all('SELECT o.*,u.username FROM offers o JOIN users u ON u.id=o.actor_id WHERE request_id=? ORDER BY revision DESC', input.requestId),
        deliveries: deal ? await all(`SELECT d.*,i.readings_wh FROM deliveries d LEFT JOIN delivery_intervals i ON i.delivery_id=d.id
          WHERE d.deal_id=? ORDER BY d.reported_at DESC`, deal.id) : [],
        events: deal ? await all('SELECT e.*,u.username FROM deal_events e JOIN users u ON u.id=e.actor_id WHERE deal_id=? ORDER BY occurred_at', deal.id) : [],
      })
    }
    if (user.status !== 'approved' || user.role === 'viewer') throw new Failure('An approved company and trading access are required.', 403)
    const trader = () => { if (user.role !== 'owner' && user.role !== 'trader') throw new Failure('Trader access required.', 403) }
    const owner = () => { if (user.role !== 'owner') throw new Failure('Only the company owner can authorize this action.', 403) }
    const operator = () => { if (user.role !== 'owner' && user.role !== 'operator') throw new Failure('Operator access required.', 403) }
    if (action === 'suppliers') {
      trader()
      return response({ suppliers: await all("SELECT id,name,country FROM companies WHERE status='approved' AND id<>? ORDER BY name,id LIMIT 200", org) })
    }
    if (action === 'request') {
      trader()
      const input = z.object({ seller: username.optional(), supplierIds: z.array(uuid).min(1).max(10).optional(),
        source: z.enum(Object.keys(sources) as [keyof typeof sources, ...(keyof typeof sources)[]]).default('any'),
        point: text(120), requirements: text(1700), startAt: moment, endAt: moment, closesAt: moment,
        kw: z.number().int().positive().max(1000000) }).parse(body)
      if (!(now < input.closesAt && input.closesAt <= input.startAt && input.startAt < input.endAt) ||
          input.endAt - input.startAt > 30 * 86400000 ||
          input.startAt % 1800000 || input.endAt % 1800000) throw new Failure('Use a future deadline and a delivery window on half-hour boundaries.')
      let supplierIds = [...new Set(input.supplierIds)]
      if (!supplierIds.length && input.seller) {
        const seller = await statement(`SELECT c.id FROM users u JOIN companies c ON c.id=u.company_id
          WHERE u.username=? AND u.role='owner' AND u.disabled_at IS NULL AND c.status='approved' AND c.id<>?`, input.seller, org).first<{ id: string }>()
        if (seller) supplierIds = [seller.id]
      }
      if (!supplierIds.length) throw new Failure('Choose at least one approved supplier.', 400)
      const tenderId = id()
      const invitees = supplierIds.map(seller => ({ seller, requestId: id() }))
      const eligible = await all(`SELECT id FROM companies WHERE status='approved' AND id<>? AND id IN (${supplierIds.map(() => '?').join(',')})`, org, ...supplierIds)
      if (eligible.length !== invitees.length) throw new Failure('One or more suppliers are unavailable. Refresh and choose again.', 409)
      await db.batch(invitees.flatMap(({ requestId, seller }) => [
        statement(`INSERT INTO requests (id,buyer_id,seller_id,created_by,point,start_at,end_at,closes_at,kw,requirements,created_at)
          SELECT ?,?,c.id,?,?,?,?,?,?,?,? FROM companies c JOIN companies b ON b.id=? WHERE c.id=? AND c.status='approved' AND b.status='approved'`,
          requestId, org, user.id, input.point, input.startAt, input.endAt, input.closesAt, input.kw, input.requirements, now, org, seller),
        statement('INSERT INTO tender_requests (request_id,tender_id,source) VALUES (?,?,?)', requestId, tenderId, input.source),
      ]))
      return response({ requestId: invitees[0].requestId }, 201)
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
        AND NOT EXISTS(SELECT 1 FROM tender_requests t JOIN tender_requests sibling ON sibling.tender_id=t.tender_id
          JOIN deals d ON d.request_id=sibling.request_id WHERE t.request_id=r.id)
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
        AND NOT EXISTS(SELECT 1 FROM tender_requests t JOIN tender_requests sibling ON sibling.tender_id=t.tender_id
          JOIN deals d ON d.request_id=sibling.request_id WHERE t.request_id=r.id)
        ON CONFLICT(request_id) DO NOTHING`, id(), user.id, now, offerId, org, now, now)
      return response({ ok: true })
    }

    const dealId = z.object({ dealId: uuid }).parse(body).dealId
    const deal = await statement(`SELECT d.*,r.buyer_id,r.seller_id,r.start_at,r.end_at,r.kw FROM deals d JOIN requests r ON r.id=d.request_id
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
      const i = z.object({ reference: text(300), issuer: text(120), wh: z.number().int().min(0).max(1e12),
        previous: uuid.nullable(), readingsWh: z.array(z.number().int().min(0).max(1e12)).max(1440).optional() }).parse(body)
      if (i.readingsWh && (i.readingsWh.length !== (deal.end_at - deal.start_at) / 1800000 ||
          i.readingsWh.reduce((sum, reading) => sum + reading, 0) !== i.wh)) {
        throw new Failure('Provide one reading per half-hour, with readings that add up to the reported total.')
      }
      const entry = id()
      const results = await db.batch([
        statement(`INSERT INTO deliveries SELECT ?,id,?,?,?,?,? FROM deals WHERE id=? AND schedule_ref IS NOT NULL
          AND current_delivery_id IS ? AND (delivery_status IS NULL OR delivery_status='disputed')`,
          entry, user.id, i.issuer, i.reference, i.wh, now, deal.id, i.previous),
        ...(i.readingsWh ? [statement(`INSERT INTO delivery_intervals (delivery_id,readings_wh)
          SELECT id,? FROM deliveries WHERE id=?`, JSON.stringify(i.readingsWh), entry)] : []),
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
