"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

type AccountRoute = "login" | "signup" | "recovery" | "security" | "profile";
type AccountUser = { username: string; recoveryEnabled: boolean };
type Availability = "idle" | "checking" | "available" | "taken" | "unavailable";

const usernameFormat = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const normalizeUsername = (value: string) => value.trim().toLowerCase();
const codeFormat = /^[a-z0-9]{8}$/;

function passwordValid(value: string) {
  return value.length >= 7 && value.length <= 18 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value);
}

async function authRequest<T>(action: string, payload: Record<string, string>): Promise<T> {
  const response = await fetch("/api/auth/" + action, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), credentials: "same-origin", cache: "no-store",
  });
  const data = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok || !data) {
    const message = typeof data?.error === "string" ? data.error : "The request didn’t finish. Try again.";
    throw new Error(message);
  }
  return data as T;
}

function friendlyError(error: unknown) {
  return error instanceof Error && !(error instanceof TypeError) ? error.message : "The request didn’t finish. Try again.";
}

function FormError({ message }: { message: string }) {
  return message ? <p className="account-feedback is-error" role="alert">{message}</p> : null;
}

function PasswordField({ id, label, value, change, fresh = false, confirming = false }: {
  id: string; label: string; value: string; change: (next: string) => void; fresh?: boolean; confirming?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const status = value ? passwordValid(value) ? "Password meets all requirements." : "Use 7–18 characters, including a letter and a number."
    : "Use 7–18 characters, including a letter and a number.";
  return <div className="account-field">
    <label htmlFor={id}>{label}</label>
    <div className="account-password-input">
      <input id={id} type={revealed ? "text" : "password"} value={value} onChange={(event) => change(event.target.value)}
        required maxLength={18} minLength={fresh ? 7 : undefined}
        autoComplete={fresh || confirming ? "new-password" : "current-password"}
        aria-describedby={fresh ? id + "-tip" : undefined} />
      <button type="button" aria-controls={id} onClick={() => setRevealed(!revealed)}>{revealed ? "Hide" : "Show"}</button>
    </div>
    {fresh && <p id={id + "-tip"} aria-live="polite" className={value && passwordValid(value) ? "account-hint is-valid" : "account-hint"}>{status}</p>}
  </div>;
}

function UsernameField({ id, value, change, status }: {
  id: string; value: string; change: (next: string) => void; status?: Availability;
}) {
  const messages: Record<Availability, string> = {
    idle: "Use 3–32 characters. Start with a letter or number.",
    checking: "Checking availability…",
    available: "Username is available.",
    taken: "That username is already in use.",
    unavailable: "Couldn’t check availability. Try again.",
  };
  return <div className="account-field">
    <label htmlFor={id}>Username</label>
    <input id={id} value={value} onChange={(event) => change(event.target.value)}
      autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={32}
      aria-describedby={status ? id + "-tip" : undefined} />
    {status && <p id={id + "-tip"} className={status === "available" ? "account-hint is-valid" : "account-hint"} aria-live="polite">{messages[status]}</p>}
  </div>;
}

function RecoveryNotice({ code, title, children }: { code: string; title: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyError(false);
      setCopied(true);
    } catch {
      const selection = window.getSelection();
      if (selection && codeRef.current) {
        const range = document.createRange();
        range.selectNodeContents(codeRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setCopyError(true);
    }
  }
  return <section className="account-recovery-slip" aria-label="Recovery code">
    <h2>{title}</h2>
    <p>Save this code in a password manager. It lets you reset your password and is shown only once.</p>
    <div className="account-copy-line">
      <code ref={codeRef}>{code}</code>
      <button type="button" onClick={copy} className="account-text-button">{copied ? "Copied" : "Copy code"}</button>
    </div>
    {copyError && <p className="account-hint" role="status">Copy the selected code or write it down.</p>}
    {children}
  </section>;
}

const accountViews = {
  login: { title: "Sign in", description: "Open your private workspace and pick up where a deal left off.", side: "Your deals, in one place.", detail: "Review quotes, delivery schedules and supplier decisions in your workspace." },
  signup: { title: "Create an account", description: "Set a username and password to start your private workspace.", side: "A workspace for every deal.", detail: "Save your terms, invite counterparties and keep each decision alongside the deal." },
  recovery: { title: "Recover your account", description: "Use your recovery code to set a new password.", side: "Get back to your workspace.", detail: "Your recovery code is the one you saved when you created or secured your account." },
};

function EntryLayout({ page, children }: { page: "login" | "signup" | "recovery"; children: ReactNode }) {
  const view = accountViews[page];
  return <section className={"account-entry account-entry-" + page}>
    <div className="account-entry-content">
      <a className="account-back" href="/">← Explore the market</a>
      <h1>{view.title}</h1>
      <p className="account-intro">{view.description}</p>
      {children}
    </div>
    <aside className="account-aside">
      <div className="account-aside-copy"><h2>{view.side}</h2><p>{view.detail}</p></div>
      <div className="account-aside-graphic" aria-hidden="true"><span /><span /><span /><span /><i /><i /></div>
    </aside>
  </section>;
}

function EntryForm({ signup }: { signup: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newCode, setNewCode] = useState("");
  const [saved, setSaved] = useState(false);
  const normalized = normalizeUsername(username);

  useEffect(() => {
    if (!signup || !usernameFormat.test(normalized)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/auth/availability?username=" + encodeURIComponent(normalized), {
          signal: controller.signal, cache: "no-store",
        });
        if (!response.ok) throw new Error("Availability check failed");
        const result = await response.json() as { available?: boolean };
        if (typeof result.available !== "boolean") throw new Error("Availability check failed");
        if (!controller.signal.aborted) setAvailability(result.available ? "available" : "taken");
      } catch {
        if (!controller.signal.aborted) setAvailability("unavailable");
      }
    }, 350);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [signup, normalized, checkAttempt]);

  function changeUsername(next: string) {
    const nextNormalized = normalizeUsername(next);
    if (nextNormalized !== normalized) setAvailability(signup && usernameFormat.test(nextNormalized) ? "checking" : "idle");
    setUsername(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await authRequest<{ recoveryCode?: string }>(signup ? "signup" : "login", { username: normalized, password });
      if (signup && result.recoveryCode) {
        setPassword("");
        setNewCode(result.recoveryCode);
      } else {
        window.location.assign("/workspace");
      }
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (newCode) return <RecoveryNotice code={newCode} title="Save your recovery code">
    <label className="account-check"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /> I’ve saved my recovery code.</label>
    <button type="button" className="account-submit" disabled={!saved} onClick={() => window.location.assign("/workspace")}>Open workspace</button>
  </RecoveryNotice>;

  return <>
    <form className="account-form" onSubmit={submit}>
      <UsernameField id="account-username" value={username} change={changeUsername} status={signup ? availability : undefined} />
      {signup && availability === "unavailable" && <button className="account-text-button account-recheck" type="button"
        onClick={() => { setAvailability("checking"); setCheckAttempt(checkAttempt + 1); }}>Check again</button>}
      <PasswordField id="account-password" label="Password" value={password} change={setPassword} fresh={signup} />
      {!signup && <a className="account-form-link" href="/recovery">Forgot your password?</a>}
      <FormError message={error} />
      <button className="account-submit" disabled={busy || (signup && (availability !== "available" || !passwordValid(password)))}>
        {busy ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </button>
    </form>
    <p className="account-switch">{signup ? <>Already registered? <a href="/login">Sign in</a></> : <>New to Index Globe? <a href="/signup">Create an account</a></>}</p>
  </>;
}

function RecoveryForm() {
  const [stage, setStage] = useState<"username" | "method" | "reset" | "complete">("username");
  const [username, setUsername] = useState("");
  const [method, setMethod] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [replacementCode, setReplacementCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const normalized = normalizeUsername(username);
      if (stage === "username") {
        const result = await authRequest<{ methods: string[] }>("recovery-methods", { username: normalized });
        if (!result.methods.includes("code")) throw new Error("Recovery isn’t available for this username. Check the spelling and try again.");
        setStage("method");
      } else if (stage === "method") {
        await authRequest("verify-recovery", { username: normalized, code: code.trim().toLowerCase() });
        setCode("");
        setStage("reset");
      } else if (stage === "reset") {
        const result = await authRequest<{ recoveryCode: string }>("reset", { password });
        setPassword("");
        setConfirm("");
        setReplacementCode(result.recoveryCode);
        setStage("complete");
      }
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (stage === "complete") return <RecoveryNotice code={replacementCode} title="Password reset. Save your new code.">
    <label className="account-check"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /> I’ve saved my new code.</label>
    <button type="button" className="account-submit" disabled={!saved} onClick={() => window.location.assign("/login")}>Continue to sign in</button>
  </RecoveryNotice>;

  const mismatch = confirm.length > 0 && confirm !== password;
  return <>
    <div className="account-recovery-steps" aria-label="Recovery steps">
      {["Identify", "Verify", "Reset"].map((label, index) => {
        const current = ["username", "method", "reset"].indexOf(stage);
        return <span key={label} aria-current={index === current ? "step" : undefined} className={index <= current ? "step-active" : undefined}>{label}</span>;
      })}
    </div>
    <form className="account-form" onSubmit={submit}>
      {stage === "username" && <UsernameField id="recover-username" value={username} change={setUsername} />}
      {stage === "method" && <>
        <div className="account-field">
          <label htmlFor="recover-method">Recovery method</label>
          <select id="recover-method" value={method} onChange={(event) => setMethod(event.target.value)} required>
            <option value="">Choose a recovery method</option>
            <option value="code">Recovery code</option>
          </select>
        </div>
        {method === "code" && <div className="account-field">
          <label htmlFor="recovery-code">Recovery code</label>
          <input id="recovery-code" className="account-code-input" value={code} maxLength={8} required
            onChange={(event) => setCode(event.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="none" />
        </div>}
      </>}
      {stage === "reset" && <>
        <PasswordField id="reset-password" label="New password" value={password} change={setPassword} fresh />
        <PasswordField id="confirm-password" label="Confirm new password" value={confirm} change={setConfirm} confirming />
        {mismatch && <p className="account-hint is-error" role="status">The passwords differ.</p>}
      </>}
      <FormError message={error} />
      <button className="account-submit" disabled={busy || (stage === "method" && !codeFormat.test(code.trim().toLowerCase()))
        || (stage === "reset" && (!passwordValid(password) || confirm !== password))}>
        {busy ? "Checking…" : stage === "username" ? "Find recovery options" : stage === "method" ? "Verify recovery code" : "Reset password"}
      </button>
    </form>
    <p className="account-switch"><a href="/login">Back to sign in</a></p>
  </>;
}

function ProfilePage({ user }: { user: AccountUser }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await authRequest("logout", {});
      window.location.assign("/");
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  }
  return <section className="account-settings">
    <header className="account-settings-header">
      <div className="account-account-mark" aria-hidden="true">{user.username.slice(0, 2).toUpperCase()}</div>
      <div><h1>Profile</h1><p>Manage your Index Globe account.</p></div>
    </header>
    <div className="account-profile-card">
      <dl><div><dt>Username</dt><dd>{user.username}</dd></div><div><dt>Recovery code</dt><dd>{user.recoveryEnabled ? "Active" : "Disabled"}</dd></div></dl>
      <div className="account-profile-actions">
        <a href="/security" className="account-settings-link">Manage security <span aria-hidden="true">↗</span></a>
        <button type="button" className="account-text-button" disabled={busy} onClick={logout}>{busy ? "Signing out…" : "Sign out"}</button>
      </div>
      <FormError message={error} />
    </div>
  </section>;
}

function SecurityPage({ user }: { user: AccountUser }) {
  const [enabled, setEnabled] = useState(user.recoveryEnabled);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<"rotate" | "disable" | null>(null);
  const [busy, setBusy] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [codeMessage, setCodeMessage] = useState("");
  const [codeError, setCodeError] = useState("");

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage("");
    setPasswordError("");
    setBusy("password");
    try {
      await authRequest("password", { password });
      setPassword("");
      setConfirm("");
      setPasswordMessage("Password updated. Other sessions have been signed out.");
    } catch (cause) {
      setPasswordError(friendlyError(cause));
    } finally {
      setBusy("");
    }
  }

  async function changeCode(action: "rotate" | "disable") {
    setCodeMessage("");
    setCodeError("");
    setBusy(action);
    try {
      const result = await authRequest<{ user: AccountUser; recoveryCode?: string }>("recovery-code", { action });
      setEnabled(result.user.recoveryEnabled);
      setCode(result.recoveryCode ?? "");
      setConfirmation(null);
      if (!result.recoveryCode) setCodeMessage("Recovery code disabled.");
    } catch (cause) {
      setCodeError(friendlyError(cause));
    } finally {
      setBusy("");
    }
  }

  return <section className="account-settings">
    <a className="account-back" href="/profile">← Profile</a>
    <header className="account-settings-header">
      <div><h1>Security</h1><p>Update your password or manage the recovery code for {user.username}.</p></div>
    </header>
    <div className="account-settings-grid">
      <section className="account-profile-card">
        <h2>Change password</h2>
        <form className="account-form" onSubmit={savePassword}>
          <PasswordField id="security-password" label="New password" value={password} change={setPassword} fresh />
          <PasswordField id="security-confirm" label="Confirm new password" value={confirm} change={setConfirm} confirming />
          {confirm && confirm !== password && <p className="account-hint is-error" role="status">The passwords differ.</p>}
          <FormError message={passwordError} />
          {passwordMessage && <p className="account-feedback is-success" role="status">{passwordMessage}</p>}
          <button className="account-submit" disabled={!!busy || !passwordValid(password) || confirm !== password}>
            {busy === "password" ? "Saving…" : "Update password"}
          </button>
        </form>
      </section>
      <section className="account-profile-card account-code-panel">
        <h2>Recovery code</h2>
        <p className="account-code-status">{enabled ? "Active" : "Disabled"}</p>
        {code ? <RecoveryNotice code={code} title="Save your new recovery code">
          <button type="button" className="account-text-button" onClick={() => setCode("")}>I’ve saved it</button>
        </RecoveryNotice> : <>
          <p>{enabled ? "Replace the code if you lost it or shared it." : "Generate a code to restore access if you lose your password."}</p>
          {confirmation ? <div className="account-confirm">
            <p>{confirmation === "rotate" ? "Replacing the code makes the current one unusable." : "Disabling recovery leaves no way to reset a forgotten password."}</p>
            <div className="account-profile-actions">
              <button type="button" className="account-submit" disabled={!!busy} onClick={() => void changeCode(confirmation)}>
                {busy ? "Saving…" : confirmation === "rotate" ? "Replace code" : "Disable code"}
              </button>
              <button type="button" className="account-text-button" disabled={!!busy} onClick={() => setConfirmation(null)}>Cancel</button>
            </div>
          </div> : <div className="account-profile-actions">
            <button type="button" className="account-submit" disabled={!!busy}
              onClick={() => enabled ? setConfirmation("rotate") : void changeCode("rotate")}>
              {busy === "rotate" ? "Generating…" : enabled ? "Replace code" : "Generate code"}
            </button>
            {enabled && <button type="button" className="account-text-button" disabled={!!busy} onClick={() => setConfirmation("disable")}>Disable</button>}
          </div>}
        </>}
        <FormError message={codeError} />
        {codeMessage && <p className="account-feedback is-success" role="status">{codeMessage}</p>}
      </section>
    </div>
  </section>;
}

export function AccountPage({ page, user }: { page: AccountRoute; user?: AccountUser }) {
  if (page === "profile" || page === "security") {
    if (!user) return <section className="account-settings"><h1>Sign in to continue</h1><a href="/login">Sign in</a></section>;
    return page === "profile" ? <ProfilePage user={user} /> : <SecurityPage user={user} />;
  }
  return <EntryLayout page={page}>{page === "recovery" ? <RecoveryForm /> : <EntryForm key={page} signup={page === "signup"} />}</EntryLayout>;
}
