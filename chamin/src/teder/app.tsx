import { PaymentSettings } from './payments-ui'
import { CompanyAccessRequest } from './company-access-ui'
import { Messages, MessageTeder } from './messages'
import { CompanyVerification, VerificationQueue } from './verification'
import { Operations } from './operations'
import { useEffect, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import { Account } from './accounts'
import { call } from './client'
import type { User } from './client'
import { BunkerEnquiries, BunkerIntake, BunkerTender } from './bunker'
import { TradeInbox } from './trade-inbox'
import { Workspace } from './workspace'

import { EnergyWorkspace } from './energy'
import { Brand, Information, Landing } from './public'
import { accountPages, isWorkspacePath, publicPages } from './paths'

export function App() {
  const path = useLocation({ select: l => l.pathname })
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [unread,setUnread]=useState(0)
  useEffect(()=>{if(!user)return;const refresh=()=>call<{unread:number}>('dmUnread').then(r=>setUnread(r.unread)).catch(()=>{});void refresh();const timer=window.setInterval(()=>{if(!document.hidden)void refresh()},10000);return()=>clearInterval(timer)},[user?.id])
  useEffect(() => {
    call<{ user: User | null }>('session').then(r => setUser(r.user)).catch(err => { setError(err.message); setUser(null) })
  }, [])
  const authPage = accountPages.includes(path)
  return <div className="shell">
    <header className="masthead"><Brand /><nav aria-label="Main navigation">
      {user ? <><a href={user.bunker_operator?"/workspace/operations":"/workspace/energy"}>{user.bunker_operator?"Operations":"Energy"}</a>{!!user.bunker_operator&&<a href="/workspace/energy">Energy cases</a>}<a href="/workspace/power">Power records</a><a href="/workspace/messages">Messages{unread?` (${unread})`:""}</a><a href="/workspace/bunkers">Marine fuel</a><a href="/workspace/inbox">Inbox</a><a href="/workspace/payments">Payments</a>{user.workspace_kind === 'customer' && <><a href="/workspace/company">Verification</a>{user.role!=='applicant'&&<a href="/workspace/team">Company access</a>}</>}{!!user.reviewer && <a href="/workspace/review">Reviews</a>}
        <button className="secondary" type="button" onClick={async () => { try { await call('logout'); location.assign('/') } catch (err) { setError(err instanceof Error ? err.message : 'Could not sign out.') } }}>Sign out</button></> :
        <><a className="nav-markets" href="/#markets">Markets</a><a href="/login">Sign in</a><a className="nav-register" href="/register">Register</a></>}
    </nav></header>
    <main id="main">
      {error && <p role="alert" className="error">{error}</p>}
      {path === '/' ? <Landing user={user ?? null} /> :
        path === '/access' ? <CompanyAccessRequest/> : path === '/bunker' ? <BunkerIntake /> :
        authPage ? (user ? <section className="auth-panel"><h1>You’re signed in</h1><a className="button" href="/workspace/energy">Open workspace</a></section> :
          <Account key={path} page={path} signedIn={async () => {const result=await call<{user:User}>('session');location.assign(result.user.bunker_operator?'/workspace/operations':'/workspace/energy')}} />) :
        (path === '/supply' || path === '/sell') ? <section className="auth-panel"><h1>{path === '/sell' ? 'Offer available energy supply' : 'Find energy supply'}</h1><p>Submit a private requirement or available supply for any delivery country. Teder reviews the route and approaches relevant counterparties with your permission.</p><a className="button" href={user ? '/workspace/energy/new?side='+(path === '/sell'?'sell':'buy') : '/register'}>{user ? 'Continue' : 'Register your company'}</a>{!user && <p>Already registered? <a href="/login">Sign in</a> and open Energy.</p>}</section> :
        publicPages.includes(path) ? <Information page={path} /> :
        isWorkspacePath(path) ?
          user === undefined ? <p role="status">Loading workspace…</p> : user ? (path === '/workspace/payments' ? <PaymentSettings user={user}/> : path === '/workspace/operations' ? (user.bunker_operator ? <Operations/> : <p>Operator access required.</p>) : path.startsWith('/workspace/messages') ? <Messages path={path}/> : path === '/workspace/company' ? <CompanyVerification user={user}/> : path === '/workspace/review' ? (user.bunker_operator ? <VerificationQueue/> : <CompanyVerification user={user}/>) : path === '/workspace' ? (user.bunker_operator ? <Operations/> : <EnergyWorkspace user={user} path="/workspace/energy"/>) : path.startsWith('/workspace/energy') ? <EnergyWorkspace user={user} path={path} /> : path === '/workspace/inbox' ? <TradeInbox /> : (path === '/workspace/bunkers' || (path === '/workspace' && user.workspace_kind === 'operations')) ? <BunkerEnquiries user={user} /> : path.startsWith('/workspace/bunkers/') ? <BunkerTender user={user} id={path.split('/')[3]} /> : <Workspace user={user} path={path} />) :
          <section className="auth-panel"><h1>Company access</h1><p>Sign in to see your company’s private requests and deals.</p><a className="button" href="/login">Sign in</a></section> :
        <section className="auth-panel"><h1>Page not found</h1><a href="/">Go to Teder</a></section>}
    </main>
    {user&&!user.bunker_operator&&<div className="support-entry"><MessageTeder/></div>}
    <footer><span>Teder · Pendia LLC · Physical energy trading</span><nav aria-label="Footer"><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav></footer>
  </div>
}
