import { Router, type Request, type Response, type RequestHandler } from 'express';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { hash, compare } from 'bcryptjs';
import { z } from 'zod';
import type { FoodDB } from './database.js';
import { fail } from './errors.js';
export type AuthOptions = { db: FoodDB; setupToken: string; origins: string[]; secureCookie: boolean };
export type Identity = { id: string; username: string; role: string; sessionId: string; csrf: string };
declare global { namespace Express { interface Request { identity?: Identity } } }
export const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const cookie = (req: Request, name: string) => { const p = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`)); return p?.slice(name.length + 1); };
const equals = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const credentials = z.object({ username: z.string().trim().min(2).max(60).regex(/^[\p{L}\p{N}_-]+$/u, '用户名只能包含文字、数字、下划线和连字符'), password: z.string().min(10).max(72), device: z.string().trim().max(80).default('浏览器') });
export function authSystem(options: AuthOptions) {
  const { db } = options;
  const attach: RequestHandler = (req, _res, next) => {
    const token = cookie(req, 'wefood_session');
    if (token) {
      const row = db.prepare('SELECT u.id,u.username,u.role,s.id sessionId,s.csrf FROM sessions s JOIN users u ON u.id=s.owner_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token), Date.now()) as Identity | undefined;
      if (row) { req.identity = row; db.prepare('UPDATE sessions SET last_seen=? WHERE id=?').run(Date.now(), row.sessionId); }
    }
    next();
  };
  const requireAuth: RequestHandler = (req, _res, next) => { if (!req.identity) fail(401, 'AUTH_REQUIRED', '请先登录'); next(); };
  const protect: RequestHandler = (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
    const origin = req.get('Origin');
    if (!origin || !options.origins.includes(origin)) fail(403, 'ORIGIN', '请求来源不受信任');
    const supplied = req.get('X-CSRF-Token') || '';
    const expected = req.identity?.csrf || cookie(req, 'wefood_handshake') || '';
    if (!expected || !equals(supplied, expected)) fail(403, 'CSRF', '页面已过期，请重新打开后再操作');
    next();
  };
  const router = Router();
  const attempts = new Map<string, { count: number; reset: number }>();
  const rateLimit: RequestHandler = (req, _res, next) => {
    const key = req.ip || 'local'; const now = Date.now();
    for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
    const v = attempts.get(key) || { count: 0, reset: now + 15 * 60_000 };
    if (++v.count > 30) fail(429, 'RATE_LIMIT', '尝试次数过多，请稍后再试');
    attempts.set(key, v); next();
  };
  function login(res: Response, user: { id: string; username: string; role: string }, device: string) {
    const token = secret(), csrf = secret(), sessionId = randomUUID(), now = Date.now();
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)').run(sessionId, user.id, digest(token), csrf, device, now, now + 30 * 86400_000, now);
    res.cookie('wefood_session', token, { httpOnly: true, secure: options.secureCookie, sameSite: 'strict', maxAge: 30 * 86400_000, path: '/' });
    return { user, csrf };
  }
  router.get('/status', (req, res) => {
    let csrf = req.identity?.csrf || cookie(req, 'wefood_handshake');
    if (!csrf) { csrf = secret(); res.cookie('wefood_handshake', csrf, { httpOnly: true, secure: options.secureCookie, sameSite: 'strict', maxAge: 3600_000, path: '/' }); }
    res.json({ data: { initialized: !!db.prepare('SELECT id FROM users LIMIT 1').get(), user: req.identity ? { id: req.identity.id, username: req.identity.username, role: req.identity.role } : null, csrf } });
  });
  router.post('/setup', rateLimit, async (req, res) => {
    const c = credentials.parse(req.body);
    if (!equals(String(req.body.setupToken || ''), options.setupToken)) fail(403, 'SETUP_TOKEN', '初始化令牌不正确，请查看本机启动终端');
    const password = await hash(c.password, 12);
    const user = db.transaction(() => {
      if (db.prepare('SELECT id FROM users LIMIT 1').get()) fail(409, 'INITIALIZED', '服务已初始化，请登录');
      const user = { id: randomUUID(), username: c.username, role: 'admin' };
      db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(user.id, user.username, password, user.role);
      const now = new Date().toISOString();
      db.prepare('INSERT INTO people VALUES (?,?,?,?,?,?)').run(randomUUID(), user.id, 1, now, now, JSON.stringify({ name: '我', archived: false }));
      return user;
    })();
    res.status(201).json({ data: login(res, user, c.device) });
  });
  router.post('/login', rateLimit, async (req, res) => {
    const c = credentials.parse(req.body);
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(c.username) as { id: string; username: string; role: string; password: string } | undefined;
    if (!row || !await compare(c.password, row.password)) fail(401, 'LOGIN_FAILED', '用户名或密码不正确');
    res.json({ data: login(res, { id: row.id, username: row.username, role: row.role }, c.device) });
  });
  router.post('/register', rateLimit, async (req, res) => {
    const c = credentials.parse(req.body), tokenHash = digest(String(req.body.invite || ''));
    const password = await hash(c.password, 12);
    const user = db.transaction(() => {
      if (!db.prepare('SELECT hash FROM invites WHERE hash=? AND expires_at>?').get(tokenHash, Date.now())) fail(403, 'INVITE_INVALID', '邀请已过期或被使用');
      const user = { id: randomUUID(), username: c.username, role: 'user' };
      db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(user.id, user.username, password, user.role);
      db.prepare('DELETE FROM invites WHERE hash=?').run(tokenHash);
      const now = new Date().toISOString(); db.prepare('INSERT INTO people VALUES (?,?,?,?,?,?)').run(randomUUID(), user.id, 1, now, now, JSON.stringify({ name: '我', archived: false })); return user;
    })();
    res.status(201).json({ data: login(res, user, c.device) });
  });
  router.use(requireAuth);
  router.get('/me', (req, res) => res.json({ data: { user: { id: req.identity!.id, username: req.identity!.username, role: req.identity!.role }, csrf: req.identity!.csrf } }));
  router.post('/logout', (req, res) => { db.prepare('DELETE FROM sessions WHERE id=?').run(req.identity!.sessionId); res.clearCookie('wefood_session', { path: '/' }); res.json({ data: { ok: true } }); });
  router.get('/sessions', (req, res) => res.json({ data: (db.prepare('SELECT id,device,created_at createdAt,last_seen lastSeen FROM sessions WHERE owner_id=? AND expires_at>? ORDER BY last_seen DESC').all(req.identity!.id, Date.now()) as { id: string }[]).map(s => ({ ...s, current: s.id === req.identity!.sessionId })) }));
  router.delete('/sessions/:id', (req, res) => { db.prepare('DELETE FROM sessions WHERE id=? AND owner_id=?').run(req.params.id, req.identity!.id); res.json({ data: { ok: true } }); });
  router.post('/password', async (req, res) => {
    const input = z.object({ current: z.string().max(72), password: z.string().min(10).max(72) }).parse(req.body);
    const user = db.prepare('SELECT password FROM users WHERE id=?').get(req.identity!.id) as { password: string };
    if (!await compare(input.current, user.password)) fail(403, 'PASSWORD', '原密码不正确');
    const h = await hash(input.password, 12);
    db.transaction(() => { db.prepare('UPDATE users SET password=? WHERE id=?').run(h, req.identity!.id); db.prepare('DELETE FROM sessions WHERE owner_id=?').run(req.identity!.id); })();
    res.clearCookie('wefood_session', { path: '/' }); res.json({ data: { ok: true } });
  });
  router.post('/invites', (req, res) => { if (req.identity!.role !== 'admin') fail(403, 'ADMIN', '仅管理员可以创建邀请'); const token = secret(); db.prepare('INSERT INTO invites VALUES (?,?,?)').run(digest(token), req.identity!.id, Date.now() + 7 * 86400_000); res.status(201).json({ data: { token } }); });
  return { attach, protect, requireAuth, router };
}
