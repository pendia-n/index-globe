import { useEffect, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import { Account } from './accounts'
import { call } from './client'
import type { User } from './client'
import { Workspace } from './workspace'

function Landing({ user }: { user: User | null }) {
  return <>
    <section className="hero">
      <div><p className="eyebrow">Private power procurement</p><h1>Secure the<br />supply window<span>.</span></h1>
        <p>Request physical power, negotiate a firm offer and keep the agreement and delivery record in one place.</p>
        <a className="button" href={user ? '/workspace' : '/register'}>{user ? 'Open workspace' : 'Register your company'} <span aria-hidden="true">↗</span></a>
      </div>
      <div className="schedule-sheet"><p className="eyebrow">Sample delivery window</p><div className="schedule-quantity">2.0 MWh</div><p>0.5 MW · 18:00–22:00 SGT</p>
        <div className="cells" aria-label="Illustration of four consecutive hours of delivery"><span>18:00</span><span>19:00</span><span>20:00</span><span>21:00</span></div>
        <small>Illustrative terms</small>
      </div>
    </section>
    <div className="workflow"><div><b>Request</b><p>Specify the delivery point and hours.</p></div><div><b>Negotiate</b><p>Invite a supplier and review its firm offer.</p></div><div><b>Confirm</b><p>Record the agreement and partner delivery evidence.</p></div></div>
  </>
}

export function App() {
  const path = useLocation({ select: l => l.pathname })
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [error, setError] = useState('')
  useEffect(() => {
    call<{ user: User | null }>('session').then(r => setUser(r.user)).catch(err => { setError(err.message); setUser(null) })
  }, [])
  const authPage = ['/login', '/register', '/recovery'].includes(path)
  return <div className="shell">
    <header className="masthead"><a className="brand" href="/" aria-label="Teder home">teder<span>.</span></a><nav aria-label="Main navigation">
      {user ? <><a href="/workspace">Workspace</a><a href="/workspace/team">Company access</a>{!!user.reviewer && <a href="/workspace/review">Reviews</a>}
        <button className="secondary" type="button" onClick={async () => { try { await call('logout'); location.assign('/') } catch (err) { setError(err instanceof Error ? err.message : 'Could not sign out.') } }}>Sign out</button></> :
        <><a href="/login">Sign in</a><a href="/register">Register</a></>}
    </nav></header>
    <main id="main">
      {error && <p role="alert" className="error">{error}</p>}
      {path === '/' ? <Landing user={user ?? null} /> :
        authPage ? (user ? <section className="auth-panel"><h1>You’re signed in</h1><a className="button" href="/workspace">Open workspace</a></section> :
          <Account key={path} page={path} signedIn={() => location.assign('/workspace')} />) :
        path === '/workspace' || path.startsWith('/workspace/') ?
          user === undefined ? <p role="status">Loading workspace…</p> : user ? <Workspace user={user} path={path} /> :
          <section className="auth-panel"><h1>Company access</h1><p>Sign in to see your company’s private requests and deals.</p><a className="button" href="/login">Sign in</a></section> :
        <section className="auth-panel"><h1>Page not found</h1><a href="/">Go to Teder</a></section>}
    </main>
    <footer><span>Teder · Physical energy procurement</span><a href="/workspace">Company workspace</a></footer>
  </div>
}
