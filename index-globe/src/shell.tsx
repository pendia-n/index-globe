import { SignOut } from "./sign-out";

type User = { username: string };
export function Shell({ user, active, children }: { user?: User | null; active?: string; children: React.ReactNode }) {
  const nav = [
    ["/", "market", "Market", "M3 17h4V7H3zM10 17h4V3h-4zM17 17h4v-6h-4z"],
    ["/about", "about", "How it works", "M3 6h5v5H3zM16 13h5v5h-5zM8 8.5h5v7h3"],
    ["/pricing", "pricing", "Pricing", "M3 6h18v12H3zM3 10h18M6 15h4"],
    ...(user ? [["/workspace", "workspace", "Workspace", "M3 6h18v14H3zM8 6V3h8v3M3 11h18"]] : []),
  ];
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="site-head"><div className="wrap head-inner">
      <a className="site-brand" href="/" aria-label="Index Globe home"><img src="/index.svg" width={34} height={34} alt="" /><span>Index Globe</span></a>
      <nav aria-label="Main navigation">{nav.map(([href, key, label, path]) => <a key={key} href={href} aria-label={label} title={label} aria-current={active === key ? "page" : undefined}>
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={path} /></svg><span>{label}</span>
      </a>)}</nav>
      <div className="head-account">{user ? <><a className="account-tag" href="/profile">{user.username}</a><SignOut /></> : <a className="account-tag" href="/login">Sign in</a>}</div>
    </div></header>
    <main id="main" className="wrap">{children}</main>
    <footer className="site-foot wrap"><span>Index Globe</span><div><a href="/about">How it works</a><a href="/announcements">Announcements</a>{user && <a href="/security">Security</a>}</div></footer>
  </>;
}
