import crypto from "node:crypto";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { paths } from "./config.js";
import { JsonStore } from "./store.js";
import { BRAND_IDS } from "./brands.js";

const COOKIE = "miz_session";
const SESSION_DAYS = 14;

// ---------- segredo de sessão (gerado 1x e guardado no volume) ----------
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(paths.secret)) return fs.readFileSync(paths.secret, "utf8").trim();
  const s = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(paths.secret, s, { mode: 0o600 });
  return s;
}

// ---------- usuários ----------
let users;
let secret;

export function initAuth() {
  secret = loadSecret();
  users = new JsonStore(paths.users, null);
  if (!users.data) {
    // Primeira inicialização: importa os usuários iniciais (senhas já em hash).
    const seed = JSON.parse(fs.readFileSync(paths.seedUsers, "utf8"));
    users.data = seed.map((u) => ({
      email: u.email.toLowerCase(),
      name: u.name || u.email.split("@")[0],
      hash: u.hash,
      mustChangePassword: true,
      passwordVersion: 1,
    }));
    users.save();
    console.log(`[auth] ${users.data.length} usuária(s) inicial(is) criada(s).`);
  }
}

function findUser(email) {
  return users.data.find((u) => u.email === String(email || "").trim().toLowerCase());
}

// ---------- token assinado no cookie ----------
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function setSession(req, res, user) {
  const token = sign({
    e: user.email,
    pv: user.passwordVersion,
    exp: Date.now() + SESSION_DAYS * 864e5,
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: SESSION_DAYS * 864e5,
    path: "/",
  });
}

// ---------- proteção simples contra força bruta ----------
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(key, list);
  return list.length >= 10;
}
function recordFailure(key) {
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
}

// ---------- middlewares ----------
export function loadUser(req, _res, next) {
  const p = verify(readCookie(req, COOKIE));
  if (p) {
    const u = findUser(p.e);
    if (u && u.passwordVersion === p.pv) req.user = u;
  }
  next();
}

/** Exige login. Se a senha ainda é a provisória, só libera a troca de senha. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Faça login para continuar." });
  if (req.user.mustChangePassword) {
    return res.status(403).json({ error: "Defina uma nova senha antes de continuar.", mustChangePassword: true });
  }
  next();
}

/** Bloqueia requisições de alteração vindas de outros sites. */
export function sameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return res.status(403).json({ error: "Origem não permitida." });
      }
    } catch {
      return res.status(403).json({ error: "Origem inválida." });
    }
  }
  next();
}

/** Marcas que a usuária pode gerenciar. Sem lista definida = todas. */
export function userBrands(u) {
  const list = Array.isArray(u?.brands) ? u.brands.filter((b) => BRAND_IDS.includes(b)) : [];
  return list.length ? list : BRAND_IDS;
}

function publicUser(u) {
  return { email: u.email, name: u.name, mustChangePassword: !!u.mustChangePassword, brands: userBrands(u) };
}

// ---------- rotas ----------
export function authRoutes(app) {
  app.post("/api/login", async (req, res) => {
    const { email, password } = req.body || {};
    const key = `${req.ip}|${String(email).toLowerCase()}`;
    if (tooManyAttempts(key)) {
      return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos e tente de novo." });
    }
    const user = findUser(email);
    const ok = user && (await bcrypt.compare(String(password || ""), user.hash));
    if (!ok) {
      recordFailure(key);
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    }
    attempts.delete(key);
    setSession(req, res, user);
    res.json({ user: publicUser(user) });
  });

  app.post("/api/logout", (req, res) => {
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  app.get("/api/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Não autenticada." });
    res.json({ user: publicUser(req.user) });
  });

  app.post("/api/change-password", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Faça login para continuar." });
    const { currentPassword, newPassword } = req.body || {};
    const user = req.user;
    if (!(await bcrypt.compare(String(currentPassword || ""), user.hash))) {
      return res.status(400).json({ error: "A senha atual está incorreta." });
    }
    const pw = String(newPassword || "");
    if (pw.length < 8) return res.status(400).json({ error: "A nova senha precisa ter pelo menos 8 caracteres." });
    if (await bcrypt.compare(pw, user.hash)) {
      return res.status(400).json({ error: "A nova senha precisa ser diferente da atual." });
    }
    user.hash = await bcrypt.hash(pw, 11);
    user.mustChangePassword = false;
    user.passwordVersion += 1; // encerra sessões antigas
    users.save();
    setSession(req, res, user);
    res.json({ user: publicUser(user) });
  });
}
