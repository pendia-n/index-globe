import { useEffect, useState } from 'react'
import { call, field } from './client'
import { Copy, Form, Input } from './forms'
import { findRegistry, registries, registryNumber } from './registries'

function newCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), value => value.toString(16).padStart(2, '0')).join('').match(/.{5}/g)!.join('-')
}
function normalized(s: string) { return s.replace(/[\s-]/g, '').toLowerCase() }
function RecoveryFields({ code, replace }: { code: string; replace: (code: string) => void }) {
  const [confirmation, setConfirmation] = useState('')
  const [copied, setCopied] = useState(false)
  return <div className="recovery">
    <strong>Your recovery code</strong>
    <p>Keep this in a password manager or somewhere only you can access. You’ll need it and your username to reset your password.</p>
    {code ? <><code className="code">{code}</code><Copy value={code} after={() => setCopied(true)}>Copy recovery code</Copy>
      <Input label="Paste the code you saved" name="recoveryConfirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" onPaste={() => setCopied(true)} />
      {confirmation && normalized(confirmation) !== normalized(code) && <small className="error">The codes don’t match.</small>}
      <label className="check"><input name="saved" type="checkbox" required disabled={!copied} /> I saved this code somewhere I can retrieve it.</label>
    </> : <button type="button" className="secondary" onClick={() => replace(newCode())}>Generate recovery code</button>}
  </div>
}
function Password({ newPassword }: { newPassword?: boolean }) {
  const [value, setValue] = useState('')
  return <><Input label={newPassword ? 'New password' : 'Password'} name="password" value={value} onChange={e => setValue(e.target.value)} type="password" autoComplete={newPassword ? 'new-password' : 'current-password'} minLength={newPassword ? 12 : undefined} maxLength={newPassword ? 18 : 128} />
  {newPassword && <small>{value && /^(?=.*[a-z])(?=.*\d).{12,18}$/i.test(value) ? 'Password meets the requirements.' : 'Use 12–18 characters with at least one letter and one digit.'}</small>}</>
}
export function Account({ page, signedIn }: { page: string; signedIn: () => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [availability, setAvailability] = useState('')
  const [identified, setIdentified] = useState(false)
  const [invite, setInvite] = useState('')
  const [message, setMessage] = useState('')
  const [country, setCountry] = useState('')
  const [registration, setRegistration] = useState('')
  const registry = findRegistry(country)
  const registryValid = registry?.pattern.test(registryNumber(country, registration))

  const register = page === '/register'
  const recovery = page === '/recovery'
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invite') || ''
    setInvite(token)
    if (token) window.history.replaceState(null, '', '/register')
  }, [])
  useEffect(() => {
    if (!register || !/^[a-z0-9][a-z0-9_.-]{2,31}$/i.test(name)) return
    let active = true
    const timer = window.setTimeout(() => {
      call<{ available: boolean }>('available', { username: name }).then(r => {
        if (active) setAvailability(r.available ? 'Username available' : 'Username is taken')
      }).catch(() => { if (active) setAvailability('Availability will be checked on submission.') })
    }, 450)
    return () => { active = false; window.clearTimeout(timer) }
  }, [name, register])
  return <section className="auth-panel">
    <a className="eyebrow" href="/">Teder / Company access</a>
    <h1>{register ? (invite ? 'Join your company' : 'Register your company') : recovery ? 'Recover your account' : 'Sign in'}</h1>
    {register && <p>{invite ? 'Create your own username and recovery code to join the workspace.' : 'Register one workspace for your legal entity. Already have a Teder workspace? Ask your company owner for your own invitation link.'}</p>}
    {message ? <><p role="status">{message}</p><a className="button" href="/login">Go to sign in</a></> : <Form key={String(identified)} submit={recovery ? (identified ? 'Reset password' : 'Continue') : register ? 'Register' : 'Sign in'}
      disabled={(register && availability === 'Username is taken') || ((register || (recovery && identified)) && !code) || (register && !invite && !registryValid)}
      onSubmit={async data => {
        if (recovery && !identified) { setIdentified(true); return }
        if (register || recovery) {
          if (normalized(field(data, 'recoveryConfirmation')) !== normalized(code) || !data.has('saved')) throw new Error('Copy, paste and save your recovery code first.')
        }
        await call(recovery ? 'recover' : register ? 'register' : 'login', {
          username: name, saved: data.has('saved'), password: field(data, 'password'), code, recoveryConfirmation: field(data, 'recoveryConfirmation'),
          company: field(data, 'company'), country, registryRegion: field(data, 'registryRegion'), registration, invite, oldCode: field(data, 'oldCode'),
        })
        if (recovery) {
          setCode('')
          setMessage('Password reset. Your new recovery code replaces your previous code. Sign in with your new password.')
        } else signedIn()
      }}>
      {recovery && identified ? <p className="username"><strong>{name}</strong> <button type="button" className="secondary" onClick={() => { setIdentified(false); setCode('') }}>Change username</button></p> :
        <Input label="Username" name="username" placeholder="3–32 letters, numbers, dots or dashes" autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{2,31}" value={name} onChange={e => { setName(e.target.value); setAvailability('') }} />}
      {register && availability && <small role="status">{availability}</small>}
      {register && !invite && <>
        <Input label="Legal company name" name="company" autoComplete="organization" maxLength={120} />
        <label>Country or territory of registration
          <select name="country" autoComplete="country" required value={country} onChange={event => { setCountry(event.target.value); setRegistration('') }}>
            <option value="">Choose where your company is registered</option>
            {Object.entries(registries).map(([key, item]) => <option key={key} value={key}>{item.name}</option>)}
            <option value="other">Other jurisdiction</option>
          </select>
        </label>
        {country === 'other' && <p className="notice">This registry is outside the current signup coverage. Ask your Teder pilot contact about registering it.</p>}
        {registry && <>
          {registry.regions.length > 0 && <label>{country === 'US' ? 'State or territory of formation' : 'Issuing registry'}
            <select key={country} name="registryRegion" required defaultValue="">
              <option value="">Choose the issuing jurisdiction</option>
              {registry.regions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>}
          <Input label={registry.label} name="registration" maxLength={80} value={registration} onChange={event => setRegistration(event.target.value)} spellCheck={false} aria-describedby="registry-hint" aria-invalid={!!registration && !registryValid} />
          <small id="registry-hint" className="registry-hint">{registry.hint}{registration && !registryValid && ' Check the format before continuing.'}</small>
        </>}
      </>}
      {recovery && identified && <Input label="Current recovery code" name="oldCode" autoComplete="off" maxLength={100} />}
      {(!recovery || identified) && <Password newPassword={register || recovery} />}
      {(register || (recovery && identified)) && <RecoveryFields key={code} code={code} replace={setCode} />}
    </Form>}
    <nav className="auth-links">{page !== '/login' && <a href="/login">Sign in</a>}{!register && <a href="/register">Register a company</a>}{!recovery && <a href="/recovery">Use a recovery code</a>}</nav>
  </section>
}
