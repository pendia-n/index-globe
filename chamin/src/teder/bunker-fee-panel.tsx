import { useEffect, useState } from 'react'
import { call, field } from './client'
import { Form, Input } from './forms'

type Fee = { invoice_ref: string; amount_cents: number; payment_ref: string | null; received_at: number | null }
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export function BunkerFeePanel({ orderId, canReport }: {orderId: string; canReport: boolean}) {
  const [data,setData] = useState<{fee: Fee|null; operator:boolean; closed:boolean}|null>(null)
  const [error,setError] = useState('')
  async function refresh() { setData(await call('bunkerFee',{orderId})) }
  useEffect(() => { refresh().catch(err => setError(err.message)) },[orderId])
  async function act(action: string, parameters: Record<string, unknown>) {
    await call(action,{orderId,...parameters})
    await refresh()
  }
  if (error) return <p role="alert" className="error">{error}</p>
  if (!data?.fee && !(data?.operator && data.closed)) return null
  const fee = data.fee
  return <section>
    <h3>Teder service fee</h3>
    {fee && <p>{fee.invoice_ref} · {usd.format(fee.amount_cents / 100)} · {fee.received_at ? 'Receipt confirmed' : fee.payment_ref ? 'Awaiting receipt confirmation' : 'Unpaid'}</p>}
    {data.operator && !fee && <Form submit="Record Teder fee invoice" onSubmit={fields => act('bunkerFeeIssue',{
      payer:field(fields,'payer'),reference:field(fields,'reference'),amount:Math.round(Number(field(fields,'amount'))*100),
    })}>
      <label>Agreed payer<select name="payer"><option value="buyer">Buyer</option><option value="supplier">Supplier</option></select></label>
      <Input label="Teder invoice number" name="reference" maxLength={300} />
      <Input label="Agreed fee · USD" name="amount" type="number" min=".01" step=".01" />
    </Form>}
    {fee && !fee.received_at && (data.operator ? fee.payment_ref && <Form submit="Confirm Teder received payment" onSubmit={() =>
      act('bunkerFeeReceive',{reference:fee.payment_ref})}>
      <label className="check"><input type="checkbox" required /> Teder received the full service fee against {fee.payment_ref}.</label>
    </Form> : canReport && <Form submit="Report Teder fee payment" onSubmit={fields => act('bunkerFeeReport',{reference:field(fields,'reference')})}>
      <Input label="Teder service fee payment reference" name="reference" maxLength={300} defaultValue={fee.payment_ref ?? ''} />
    </Form>)}
  </section>
}
