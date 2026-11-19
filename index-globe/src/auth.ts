import { env } from "cloudflare:workers";

const bindings = env as unknown as { DB: D1Database; INDEX_GLOBE_JWT_SECRET?: string };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sessionLifetime = 28 * 24 * 60 * 60;
const resetLifetime = 10 * 60;
const day = 24 * 60 * 60;
const sessionCookie = "__Host-index_globe";
const recoveryCookie = "__Host-index_globe_recovery";
const usernamePattern = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

export type AccountUser = { id: string; username: string; recoveryEnabled: boolean };
type Payload = Record<string, unknown>;
type ActiveSession = { sessionId: string; authVersion: number; user: AccountUser };
type Credentials = {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  recovery_hash: string | null;
  auth_version: number;
};

function now() {
  return Math.floor(Date.now() / 1000);
}

function encodeBytes(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBytes(encoded: string) {
  return Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

const jwtHeader = encodeBytes(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
let importedSigningKey: Promise<CryptoKey> | undefined;

function signingKey() {
  const secret = bindings.INDEX_GLOBE_JWT_SECRET;
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error("INDEX_GLOBE_JWT_SECRET must contain 32 bytes encoded as hex.");
  }
  const bytes = Uint8Array.from(secret.match(/../g) ?? [], (value) => Number.parseInt(value, 16));
  return importedSigningKey ??= crypto.subtle.importKey(
    "raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

async function sign(value: string) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(value)));
}

async function digest(value: string) {
  return encodeBytes(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function recoveryHash(id: string, code: string) {
  return encodeBytes(await sign("index-globe:recovery:" + id + ":" + code));
}

function generateRecoveryCode() {
  let code = "";
  while (code.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < 252) code += alphabet[byte % alphabet.length];
      if (code.length === 8) break;
    }
  }
  return code;
}

function normalizedUsername(value: unknown) {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return usernamePattern.test(username) ? username : null;
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 7 && value.length <= 18 &&
    /[A-Za-z]/.test(value) && /[0-9]/.test(value);
}

async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bytes = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations: 100_000, salt: decodeBytes(salt) }, key, 256,
  );
  return encodeBytes(new Uint8Array(bytes));
}

async function passwordRecord(password: string) {
  const salt = encodeBytes(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hashPassword(password, salt) };
}

function constantEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function userView(user: { id: string; username: string; recovery_hash: string | null }): AccountUser {
  return { id: user.id, username: user.username, recoveryEnabled: user.recovery_hash !== null };
}

function makeCookie(name: string, value: string, lifetime: number) {
  return `${name}=${value}; Max-Age=${lifetime}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function getCookie(request: Request, name: string) {
  return request.headers.get("Cookie")?.split(";")
    .map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(name + "="))?.slice(name.length + 1);
}

function json(payload: unknown, options: { status?: number; cookies?: string[] } = {}) {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  for (const cookie of options.cookies ?? []) headers.append("Set-Cookie", cookie);
  return Response.json(payload, { status: options.status ?? 200, headers });
}

function error(message: string, status = 400) {
  return json({ error: message }, { status });
}

async function sessionToken(id: string, sessionId: string, expiresAt: number) {
  const payload = encodeBytes(encoder.encode(JSON.stringify({
    iss: "index-globe", sub: id, jti: sessionId, exp: expiresAt,
  })));
  const message = jwtHeader + "." + payload;
  return message + "." + encodeBytes(await sign(message));
}

async function readSession(request: Request): Promise<ActiveSession | null> {
  const token = getCookie(request, sessionCookie);
  if (!token || token.length > 1024 || !/^[A-Za-z0-9_.-]+$/.test(token)) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== jwtHeader) return null;

  let claims: Payload;
  try {
    const verified = await crypto.subtle.verify(
      "HMAC", await signingKey(), decodeBytes(parts[2]), encoder.encode(parts[0] + "." + parts[1]),
    );
    if (!verified) return null;
    claims = JSON.parse(decoder.decode(decodeBytes(parts[1]))) as Payload;
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof DOMException) return null;
    throw err;
  }

  const time = now();
  if (claims?.iss !== "index-globe" || typeof claims.sub !== "string" || typeof claims.jti !== "string" ||
    typeof claims.exp !== "number" || !Number.isInteger(claims.exp) || claims.exp <= time) return null;

  const user = await bindings.DB.prepare(`
    SELECT u.id, u.username, u.recovery_hash, u.auth_version
    FROM auth_sessions AS s JOIN users AS u ON s.user_id = u.id AND s.auth_version = u.auth_version
    WHERE s.id = ? AND u.id = ? AND s.expires_at > ?
  `).bind(claims.jti, claims.sub, time).first<Pick<Credentials, "id" | "username" | "recovery_hash" | "auth_version">>();

  return user ? { sessionId: claims.jti, authVersion: user.auth_version, user: userView(user) } : null;
}

export async function currentUser(request: Request) {
  return (await readSession(request))?.user ?? null;
}

export const sessionUser = currentUser;

async function sessionCookieFor(user: { id: string; auth_version: number }) {
  const id = crypto.randomUUID();
  const time = now();
  const expiresAt = time + sessionLifetime;
  const token = await sessionToken(user.id, id, expiresAt);
  const [session] = await bindings.DB.batch([
    bindings.DB.prepare(`
      INSERT INTO auth_sessions (id, user_id, auth_version, expires_at)
      SELECT ?, id, auth_version, ? FROM users WHERE id = ? AND auth_version = ?
    `).bind(id, expiresAt, user.id, user.auth_version),
    bindings.DB.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(time),
  ]);
  return session.meta.changes ? makeCookie(sessionCookie, token, sessionLifetime) : null;
}

async function credentials(username: string) {
  return bindings.DB.prepare(`
    SELECT id, username, password_hash, password_salt, recovery_hash, auth_version
    FROM users WHERE username = ?
  `).bind(username).first<Credentials>();
}

async function limitAttempt(request: Request, action: string, ipLimit: number, username?: string) {
  const windowStart = Math.floor(now() / 600);
  const source = request.headers.get("CF-Connecting-IP") ?? "local";
  const targets: [string, number][] = [["ip:" + source, ipLimit]];
  if (username) targets.push(["account:" + username, 10]);

  const counters = await Promise.all(targets.map(async ([locator, limit]) => {
    const key = encodeBytes(await sign("index-globe:attempt:" + action + ":" + locator));
    return bindings.DB.prepare(`
      INSERT INTO auth_attempts (key, window_start, attempts) VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET
        attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END,
        window_start = excluded.window_start
      WHERE window_start <> excluded.window_start OR attempts < ?
    `).bind(key, windowStart, limit);
  }));

  const results = await bindings.DB.batch([
    ...counters,
    bindings.DB.prepare("DELETE FROM auth_attempts WHERE window_start < ?").bind(windowStart - 6),
  ]);
  return results.slice(0, targets.length).every((result) => result.meta.changes > 0);
}

function limited() {
  return error("Too many attempts. Try again in a few minutes.", 429);
}

async function payload(request: Request): Promise<Payload | null> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json" || !request.body) return null;
  const reader = request.body.getReader();
  let length = 0;
  let content = "";
  const streamDecoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        return null;
      }
      content += streamDecoder.decode(chunk.value, { stream: true });
    }
    const value: unknown = JSON.parse(content + streamDecoder.decode());
    return value && typeof value === "object" && !Array.isArray(value) ? value as Payload : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function availability(request: Request) {
  const username = normalizedUsername(new URL(request.url).searchParams.get("username"));
  if (!username) return json({ available: false });
  if (!(await limitAttempt(request, "availability", 90))) return limited();
  const match = await bindings.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  return json({ available: !match });
}

async function signup(request: Request, data: Payload) {
  const username = normalizedUsername(data.username);
  if (!username || !validPassword(data.password)) {
    return error("Use a valid username and a password with 7 to 18 characters, including a letter and a digit.");
  }
  if (!(await limitAttempt(request, "signup", 6))) return limited();

  const id = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const createdAt = now();
  const expiresAt = createdAt + sessionLifetime;
  const recoveryCode = generateRecoveryCode();
  const [{ hash, salt }, codeHash, token] = await Promise.all([
    passwordRecord(data.password), recoveryHash(id, recoveryCode), sessionToken(id, sessionId, expiresAt),
  ]);

  const [saved] = await bindings.DB.batch([
    bindings.DB.prepare(`
      INSERT INTO users (id, username, password_hash, password_salt, recovery_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING
    `).bind(id, username, hash, salt, codeHash, createdAt),
    bindings.DB.prepare(`
      INSERT INTO auth_sessions (id, user_id, auth_version, expires_at)
      SELECT ?, id, auth_version, ? FROM users WHERE id = ?
    `).bind(sessionId, expiresAt, id),
  ]);
  if (!saved.meta.changes) return error("That username is unavailable. Choose another one.", 409);
  return json({ user: { id, username, recoveryEnabled: true }, recoveryCode }, {
    status: 201, cookies: [makeCookie(sessionCookie, token, sessionLifetime), makeCookie(recoveryCookie, "", 0)],
  });
}

async function login(request: Request, data: Payload) {
  const username = normalizedUsername(data.username);
  const invalid = () => error("Check your username and password.", 401);
  if (!username || !validPassword(data.password)) return invalid();
  if (!(await limitAttempt(request, "login", 24, username))) return limited();

  const user = await credentials(username);
  const passwordHash = await hashPassword(data.password, user?.password_salt ?? "AAAAAAAAAAAAAAAAAAAAAA");
  if (!user || !constantEqual(passwordHash, user.password_hash)) return invalid();
  const cookie = await sessionCookieFor(user);
  if (!cookie) return invalid();
  return json({ user: userView(user) }, { cookies: [cookie, makeCookie(recoveryCookie, "", 0)] });
}

async function logout(request: Request) {
  const session = await readSession(request);
  if (session) {
    await bindings.DB.prepare("DELETE FROM auth_sessions WHERE id = ? AND user_id = ?")
      .bind(session.sessionId, session.user.id).run();
  }
  const token = getCookie(request, recoveryCookie);
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    await bindings.DB.prepare("DELETE FROM auth_recoveries WHERE token_hash = ?")
      .bind(await digest(token)).run();
  }
  return json({ user: null }, { cookies: [makeCookie(sessionCookie, "", 0), makeCookie(recoveryCookie, "", 0)] });
}

async function recoveryMethods(request: Request, data: Payload) {
  const username = normalizedUsername(data.username);
  if (!username) return json({ methods: [] });
  if (!(await limitAttempt(request, "recovery-methods", 24))) return limited();

  const account = await credentials(username);
  return json({ methods: account?.recovery_hash ? ["code"] : [] });
}

async function verifyRecovery(request: Request, data: Payload) {
  const username = normalizedUsername(data.username);
  const code = typeof data.code === "string" ? data.code.trim().toLowerCase() : "";
  const invalid = () => error("That username and recovery code could not be verified.", 401);
  if (!username || !/^[a-z0-9]{8}$/.test(code)) return invalid();
  if (!(await limitAttempt(request, "verify-recovery", 16, username))) return limited();

  const account = await credentials(username);
  const hash = await recoveryHash(account?.id ?? "unknown", code);
  if (!account?.recovery_hash || !constantEqual(hash, account.recovery_hash)) return invalid();

  const token = encodeBytes(crypto.getRandomValues(new Uint8Array(32)));
  const time = now();
  const [grant] = await bindings.DB.batch([
    bindings.DB.prepare(`
      INSERT INTO auth_recoveries (token_hash, user_id, recovery_hash, auth_version, expires_at)
      SELECT ?, id, recovery_hash, auth_version, ? FROM users WHERE id = ? AND recovery_hash = ? AND auth_version = ?
    `).bind(await digest(token), time + resetLifetime, account.id, hash, account.auth_version),
    bindings.DB.prepare("DELETE FROM auth_recoveries WHERE expires_at <= ?").bind(time),
  ]);
  if (!grant.meta.changes) return invalid();
  return json({ verified: true }, { cookies: [makeCookie(recoveryCookie, token, resetLifetime)] });
}

async function resetPassword(request: Request, data: Payload) {
  if (!validPassword(data.password)) return error("Use 7 to 18 characters, with at least one letter and one digit.");
  const token = getCookie(request, recoveryCookie);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return error("Verify a recovery code first.", 401);

  const tokenHash = await digest(token);
  const expired = () => error("Recovery has expired. Verify your recovery code again.", 401);
  const grant = await bindings.DB.prepare(`
    SELECT r.user_id FROM auth_recoveries AS r JOIN users AS u ON r.user_id = u.id
    WHERE r.token_hash = ? AND r.expires_at > ? AND r.auth_version = u.auth_version AND r.recovery_hash = u.recovery_hash
  `).bind(tokenHash, now()).first<{ user_id: string }>();
  if (!grant) return expired();

  const recoveryCode = generateRecoveryCode();
  const [{ salt, hash }, newCode] = await Promise.all([
    passwordRecord(data.password), recoveryHash(grant.user_id, recoveryCode),
  ]);
  const [updated] = await bindings.DB.batch([
    bindings.DB.prepare(`
      UPDATE users SET password_hash = ?, password_salt = ?, recovery_hash = ?, auth_version = auth_version + 1
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM auth_recoveries AS r WHERE r.token_hash = ? AND r.user_id = users.id
        AND r.expires_at > ? AND r.auth_version = users.auth_version AND r.recovery_hash = users.recovery_hash
      )
    `).bind(hash, salt, newCode, grant.user_id, tokenHash, now()),
    bindings.DB.prepare("DELETE FROM auth_recoveries WHERE token_hash = ?").bind(tokenHash),
  ]);
  if (!updated.meta.changes) return expired();
  return json({ recoveryCode }, { cookies: [makeCookie(recoveryCookie, "", 0), makeCookie(sessionCookie, "", 0)] });
}

async function changePassword(session: ActiveSession, data: Payload) {
  if (!validPassword(data.password)) return error("Use 7 to 18 characters, with at least one letter and one digit.");
  const db = bindings.DB;
  const { salt, hash } = await passwordRecord(data.password);
  const id = crypto.randomUUID();
  const time = now();
  const [receipt] = await db.batch([
    db.prepare(`
      INSERT INTO auth_password_changes (id, user_id, changed_at)
      SELECT ?, u.id, ? FROM users AS u JOIN auth_sessions AS s
        ON s.user_id = u.id AND s.auth_version = u.auth_version
      WHERE u.id = ? AND s.id = ? AND s.expires_at > ? AND u.auth_version = ?
        AND (SELECT count(*) FROM auth_password_changes WHERE user_id = u.id AND changed_at > ?) < 4
    `).bind(id, time, session.user.id, session.sessionId, time, session.authVersion, time - day),
    db.prepare(`
      UPDATE users SET password_hash = ?, password_salt = ?, auth_version = auth_version + 1
      WHERE id = ? AND EXISTS (SELECT 1 FROM auth_password_changes WHERE id = ?)
    `).bind(hash, salt, session.user.id, id),
    db.prepare(`
      UPDATE auth_sessions SET auth_version = auth_version + 1
      WHERE id = ? AND EXISTS (SELECT 1 FROM auth_password_changes WHERE id = ?)
    `).bind(session.sessionId, id),
    db.prepare("DELETE FROM auth_password_changes WHERE user_id = ? AND changed_at <= ?").bind(session.user.id, time - day),
  ]);
  if (!receipt.meta.changes) return error("Password change limit reached or your session changed. Try again later.", 429);
  return json({ user: session.user });
}

async function editRecoveryCode(session: ActiveSession, data: Payload) {
  if (data.action !== "rotate" && data.action !== "disable") return error("Choose how to manage the recovery code.");
  const newCode = data.action === "rotate" ? generateRecoveryCode() : null;
  const codeHash = newCode ? await recoveryHash(session.user.id, newCode) : null;
  const updated = await bindings.DB.prepare(`
    UPDATE users SET recovery_hash = ? WHERE id = ? AND auth_version = ? AND EXISTS (
      SELECT 1 FROM auth_sessions WHERE id = ? AND user_id = users.id
        AND auth_version = users.auth_version AND expires_at > ?
    )
  `).bind(codeHash, session.user.id, session.authVersion, session.sessionId, now()).run();
  if (!updated.meta.changes) return error("Your session changed. Sign in again.", 401);
  const user = { ...session.user, recoveryEnabled: Boolean(newCode) };
  return json(newCode ? { user, recoveryCode: newCode } : { user });
}

export async function authApi(request: Request, action: string) {
  if (request.method === "GET") {
    if (action === "session") return json({ user: await currentUser(request) });
    if (action === "availability") return availability(request);
    return error("Authentication endpoint not found.", 404);
  }
  if (request.method !== "POST") return error("Method not allowed.", 405);

  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if ((origin && origin !== new URL(request.url).origin) || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
    return error("This request was not sent from Index Globe.", 403);
  }
  const data = await payload(request);
  if (!data) return error("Supply a JSON request body.");

  switch (action) {
    case "signup": return signup(request, data);
    case "login": return login(request, data);
    case "logout": return logout(request);
    case "recovery-methods":
    case "verify-recovery":
    case "reset": {
      if (await currentUser(request)) return error("Sign out before starting account recovery.", 409);
      if (action === "recovery-methods") return recoveryMethods(request, data);
      if (action === "verify-recovery") return verifyRecovery(request, data);
      return resetPassword(request, data);
    }
    case "password":
    case "recovery-code": {
      const session = await readSession(request);
      if (!session) return error("Sign in to manage your security settings.", 401);
      if (action === "password") return changePassword(session, data);
      return editRecoveryCode(session, data);
    }
    default: return error("Authentication endpoint not found.", 404);
  }
}
