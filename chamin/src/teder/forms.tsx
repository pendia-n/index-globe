import { useState } from 'react'
import type { FormProps } from './client'

export function Form({ onSubmit, children, submit, disabled }: FormProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <form onSubmit={async event => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true)
    setError('')
    try { await onSubmit(data) } catch (err) { setError(err instanceof Error ? err.message : 'Try again.') }
    finally { setBusy(false) }
  }}>
    {children}
    {error && <p className="error" role="alert">{error}</p>}
    <button disabled={disabled || busy} type="submit">{busy ? 'Working…' : submit}</button>
  </form>
}

export function Input({ label, name, type = 'text', autoComplete, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return <label>{label}<input name={name} type={type} autoComplete={autoComplete} required {...props} /></label>
}
export function Notes({ label, name, maxLength = 1700 }: { label: string; name: string; maxLength?: number }) {
  return <label>{label}<textarea name={name} maxLength={maxLength} required rows={3} /></label>
}
export function Copy({ value, children, after }: { value: string; children: string; after?: () => void }) {
  const [status, setStatus] = useState('')
  return <><button type="button" className="secondary" onClick={async () => {
    try { await navigator.clipboard.writeText(value); setStatus('Copied'); after?.() }
    catch { setStatus('Select the value and copy it manually.') }
  }}>{children}</button> {status && <small role="status">{status}</small>}</>
}
