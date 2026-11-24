import { useEffect, useState } from 'react'
import { call, field } from './client'
import { Form } from './forms'

const categories = {
  agreement: 'Agreement',
  nomination: 'Nomination',
  'delivery-note': 'Delivery note',
  quantity: 'Quantity evidence',
  quality: 'Quality evidence',
  invoice: 'Invoice',
  payment: 'Payment evidence',
}
type Document = { id: string; category: keyof typeof categories; filename: string; bytes: number }

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })
}

export function BunkerDocumentPanel({ orderId, buyer, canUpload }: {orderId: string; buyer: boolean; canUpload: boolean}) {
  const [documents, setDocuments] = useState<Document[] | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [uploadNumber, setUploadNumber] = useState(0)
  async function refresh() {
    setDocuments((await call<{ documents: Document[] }>('bunkerDocuments',{ orderId })).documents)
  }
  useEffect(() => { refresh().catch(err => setError(err.message)) }, [orderId])
  async function download(document: Document) {
    setError('')
    try {
      const response = await fetch('/api/teder', {
        method: 'POST', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ action:'bunkerDownload', orderId, documentId:document.id }),
      })
      if (!response.ok) throw new Error('Could not download that document.')
      const url = URL.createObjectURL(await response.blob())
      const link = window.document.createElement('a')
      link.href = url
      link.download = document.filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url),1000)
    } catch (err) { setError(err instanceof Error ? err.message : 'Download failed.') }
  }
  return <section>
    <h3>Private order documents</h3>
    {!documents && !error && <p role="status">Loading documents…</p>}
    {documents?.length === 0 && <p>No files have been shared for this order.</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {documents?.length ? <ul className="records">{documents.map(document =>
      <li key={document.id}>
        <strong>{categories[document.category]}</strong>
        <span>{document.filename} · {Math.ceil(document.bytes / 1024)} KiB</span>
        <button className="secondary" type="button" onClick={() => download(document)}>Download</button>
      </li>)}</ul> : null}
    {canUpload && <Form key={uploadNumber} submit="Share private PDF" onSubmit={async data => {
      const file = data.get('file')
      if (!(file instanceof File) || !file.size || file.size > 384 * 1024) throw new Error('Choose a PDF up to 384 KiB.')
      await call('bunkerUpload', { orderId, category:field(data,'category'), name:file.name, contents:await readBase64(file) })
      setMessage('Document shared with the other party.')
      setUploadNumber(value => value + 1)
      await refresh()
    }}>
      <label>Evidence type<select name="category">
        {Object.entries(categories).filter(([key]) => buyer === (key === 'payment')).map(([key,label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      <label>PDF up to 384 KiB<input name="file" type="file" accept=".pdf,application/pdf" required /></label>
    </Form>}
  </section>
}
