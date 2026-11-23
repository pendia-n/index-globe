import { useEffect, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import { Account } from './accounts'
import { call } from './client'
import type { User } from './client'
import { Workspace } from './workspace'

import { Brand, Information, Landing } from './public'
import { accountPages, isWorkspacePath, publicPages } from './paths'

export function App() {
  const path = useLocation({ select: l => l.pathname })
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [error, setError] = useState('')
  useEffect(() => {
    call<{ user: User | null }>('session').then(r => setUser(r.user)).catch(err => { setError(err.message); setUser(null) })
  }, [])
  const authPage = accountPages.includes(path)
  return <div className="shell">
    <header className="masthead"><Brand /><nav aria-label="Main navigation">
      {user ? <><a href="/workspace">Workspace</a><a href="/workspace/team">Company access</a>{!!user.reviewer && <a href="/workspace/review">Reviews</a>}
        <button className="secondary" type="button" onClick={async () => { try { await call('logout'); location.assign('/') } catch (err) { setError(err instanceof Error ? err.message : 'Could not sign out.') } }}>Sign out</button></> :
        <><a className="nav-markets" href="/#markets">Markets</a><a href="/login">Sign in</a><a className="nav-register" href="/register">Register</a></>}
    </nav></header>
    <main id="main">
      {error && <p role="alert" className="error">{error}</p>}
      {path === '/' ? <Landing user={user ?? null} /> :
        authPage ? (user ? <section className="auth-panel"><h1>You’re signed in</h1><a className="button" href="/workspace">Open workspace</a></section> :
          <Account key={path} page={path} signedIn={() => location.assign('/workspace')} />) :
        publicPages.includes(path) ? <Information page={path} /> :
        isWorkspacePath(path) ?
          user === undefined ? <p role="status">Loading workspace…</p> : user ? <Workspace user={user} path={path} /> :
          <section className="auth-panel"><h1>Company access</h1><p>Sign in to see your company’s private requests and deals.</p><a className="button" href="/login">Sign in</a></section> :
        <section className="auth-panel"><h1>Page not found</h1><a href="/">Go to Teder</a></section>}
    </main>
    <footer><span>Teder · Physical energy trading</span><nav aria-label="Footer"><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/announcements">Announcements</a></nav></footer>
  </div>
}
