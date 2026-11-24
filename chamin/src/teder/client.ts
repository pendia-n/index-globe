export async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(action === 'bunkerUpload' ? '/api/teder?upload=bunker-document' : '/api/teder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, action }) })
  const data = await response.json()
  if (!response.ok) {
    const message = (data as { error?: string }).error
    throw new Error(message || 'Request failed.')
  }
  return data as T
}
export type User = { id: string; username: string; company_id: string; company_name: string; role: string; status: string; workspace_kind: string; reviewer: number; bunker_operator: number }
type FormProps = { onSubmit: (data: FormData) => Promise<void>; children: React.ReactNode; submit: string; disabled?: boolean }
export type { FormProps }
export function field(data: FormData, name: string) { return String(data.get(name) ?? '') }
export function localTime(value: string) { return Date.parse(value + ':00+08:00') }
export function time(value: number) { return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' }).format(value) + ' SGT' }
