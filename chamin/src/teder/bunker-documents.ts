import { z } from 'zod'

export const maxDocumentBytes = 384 * 1024
export const documentCategories = ['agreement','nomination','delivery-note','quantity','quality','invoice','payment'] as const
const upload = z.object({
  orderId: z.uuid(), category: z.enum(documentCategories), name: z.string().trim().min(1).max(120),
  contents: z.string().min(8).max(maxDocumentBytes / 3 * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
})

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
function result(data: unknown, status = 200) {
  return Response.json(data, { status, headers: privateHeaders })
}

const participant = `FROM bunker_orders o JOIN bunker_enquiries e ON e.id=o.enquiry_id
  JOIN bunker_quotes q ON q.id=o.quote_id
  WHERE o.id=? AND o.status='confirmed' AND (e.buyer_company_id=? OR q.supplier_id=?)`

export async function bunkerDocuments(
  db: D1Database,
  user: { id: string; company_id: string },
  action: string,
  body: unknown,
  now: number,
) {
  const { orderId } = z.object({ orderId: z.uuid() }).parse(body)
  const scope = [orderId, user.company_id, user.company_id]
  const access = await db.prepare('SELECT e.buyer_company_id ' + participant).bind(...scope)
    .first<{ buyer_company_id: string }>()
  if (!access) return result({ error: 'Order not found.' }, 404)

  if (action === 'bunkerDocuments') {
    const statement = db.prepare(`SELECT id,category,filename,sha256,bytes,uploaded_at FROM bunker_documents
      WHERE order_id=? ORDER BY uploaded_at DESC,id`)
    return result({ documents: (await statement.bind(orderId).all()).results })
  }
  if (action === 'bunkerDownload') {
    const { documentId } = z.object({ documentId: z.uuid() }).parse(body)
    const file = await db.prepare('SELECT filename,content FROM bunker_documents WHERE id=? AND order_id=?')
      .bind(documentId, orderId).first<{ filename: string; content: number[] }>()
    if (!file) return result({ error: 'Document not found.' }, 404)
    return new Response(new Uint8Array(file.content), {
      headers: { ...privateHeaders, 'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file.filename}"`, 'Content-Security-Policy':'sandbox' },
    })
  }

  const input = upload.parse(body)
  const buyer = access.buyer_company_id === user.company_id
  if (buyer !== (input.category === 'payment')) return result({ error: 'This evidence belongs to the other party.' }, 403)
  let bytes: Uint8Array<ArrayBuffer>
  try { bytes = Uint8Array.from(atob(input.contents), ch => ch.charCodeAt(0)) }
  catch { return result({ error: 'The document could not be decoded.' }, 400) }
  if (bytes.length > maxDocumentBytes || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    return result({ error: 'Upload a PDF of up to 384 KiB.' }, 400)
  }
  const filename = input.name.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\.pdf$/i,'').slice(0,100) + '.pdf'
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2,'0')).join('')
  const inserted = await db.prepare(`INSERT INTO bunker_documents (id,order_id,category,filename,sha256,bytes,content,uploaded_by,uploaded_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM bunker_documents WHERE order_id=?) < 24
      AND EXISTS (SELECT 1 FROM users u JOIN companies c ON c.id=u.company_id
        WHERE u.id=? AND c.id=? AND c.status='approved' AND u.disabled_at IS NULL AND u.role IN ('owner','operator'))
    ON CONFLICT(order_id,category,sha256) DO NOTHING`)
    .bind(crypto.randomUUID(), orderId, input.category, filename, hash, bytes.length, bytes.buffer, user.id, now,
      orderId, user.id, user.company_id).run()
  if (!inserted.meta.changes) {
    const existing = await db.prepare('SELECT 1 FROM bunker_documents WHERE order_id=? AND category=? AND sha256=?')
      .bind(orderId, input.category, hash).first()
    if (!existing) return result({ error: 'Upload unavailable. An order can hold up to 24 documents.' }, 409)
  }
  return result({ ok: true })
}
