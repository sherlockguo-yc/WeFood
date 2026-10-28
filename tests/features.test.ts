import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { loadConfig } from '../server/config.js';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); });
const O = 'http://localhost';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wefood-test-'));
  const db = openDatabase(dir);
  const app = createApp({ db, dataDir: dir, setupToken: 'test-setup-only', origins: [O], secureCookie: false });
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { app, db };
}
async function owner(app: ReturnType<typeof fixture>['app']) {
  const agent = request.agent(app);
  const h = await agent.get('/api/auth/status');
  const r = await agent.post('/api/auth/setup').set({ Origin: O, 'X-CSRF-Token': h.body.data.csrf }).send({ username: 'owner', password: 'owner-password-1', setupToken: 'test-setup-only' });
  return { agent, headers: { Origin: O, 'X-CSRF-Token': r.body.data.csrf } };
}
async function friend(app: ReturnType<typeof fixture>['app'], admin: Awaited<ReturnType<typeof owner>>) {
  const invite = (await admin.agent.post('/api/auth/invites').set(admin.headers).send({})).body.data.token;
  const agent = request.agent(app);
  const h = await agent.get('/api/auth/status');
  const r = await agent.post('/api/auth/register').set({ Origin: O, 'X-CSRF-Token': h.body.data.csrf }).send({ username: 'friend', password: 'friend-password-1', invite });
  return { agent, headers: { Origin: O, 'X-CSRF-Token': r.body.data.csrf } };
}
const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#c0603a' } }).png().toBuffer();

describe('配置', () => {
  it('拒绝无效端口与可信来源', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ TRUSTED_ORIGINS: 'http://a.example/path' })).toThrow(/TRUSTED_ORIGINS/);
    expect(loadConfig({ PORT: '5000', WEB_PORT: '5001' }).origins).toContain('http://127.0.0.1:5001');
  });
});

describe('初始化与邀请', () => {
  it('初始化令牌错误或重复初始化被拒绝，邀请只能使用一次', async () => {
    const { app } = fixture();
    const a = request.agent(app);
    const h = await a.get('/api/auth/status');
    const bad = await a.post('/api/auth/setup').set({ Origin: O, 'X-CSRF-Token': h.body.data.csrf }).send({ username: 'x1', password: 'password-12345', setupToken: 'wrong-token' });
    expect(bad.status).toBe(403);
    const admin = await owner(app);
    const again = request.agent(app); const h2 = await again.get('/api/auth/status');
    expect((await again.post('/api/auth/setup').set({ Origin: O, 'X-CSRF-Token': h2.body.data.csrf }).send({ username: 'x2', password: 'password-12345', setupToken: 'test-setup-only' })).status).toBe(409);
    const token = (await admin.agent.post('/api/auth/invites').set(admin.headers).send({})).body.data.token;
    const u1 = request.agent(app); const h3 = await u1.get('/api/auth/status');
    expect((await u1.post('/api/auth/register').set({ Origin: O, 'X-CSRF-Token': h3.body.data.csrf }).send({ username: 'u1', password: 'password-12345', invite: token })).status).toBe(201);
    const u2 = request.agent(app); const h4 = await u2.get('/api/auth/status');
    expect((await u2.post('/api/auth/register').set({ Origin: O, 'X-CSRF-Token': h4.body.data.csrf }).send({ username: 'u2', password: 'password-12345', invite: token })).status).toBe(403);
  });
  it('缺少 CSRF 令牌的写请求被拒绝，修改密码后旧会话失效', async () => {
    const { app } = fixture();
    const a = await owner(app);
    expect((await a.agent.post('/api/people').set({ Origin: O }).send({ name: '女朋友' })).status).toBe(403);
    const other = request.agent(app); const h = await other.get('/api/auth/status');
    await other.post('/api/auth/login').set({ Origin: O, 'X-CSRF-Token': h.body.data.csrf }).send({ username: 'owner', password: 'owner-password-1' });
    expect((await a.agent.post('/api/auth/password').set(a.headers).send({ current: 'owner-password-1', password: 'new-password-123' })).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await a.agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('照片', () => {
  it('只允许本人读取，拒绝伪装图片，引用中的照片不能删除', async () => {
    const { app } = fixture();
    const a = await owner(app);
    const up = await a.agent.post('/api/photos').set(a.headers).attach('photos', await png(), { filename: 'a.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    const photo = up.body.data[0].id;
    const read = await a.agent.get(`/api/photos/${photo}`);
    expect(read.status).toBe(200);
    expect(read.headers['content-type']).toContain('image/webp');
    const fake = await a.agent.post('/api/photos').set(a.headers).attach('photos', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const b = await friend(app, a);
    expect((await b.agent.get(`/api/photos/${photo}`)).status).toBe(404);
    expect((await b.agent.post('/api/restaurants').set(b.headers).send({ name: '偷图', photos: [photo] })).status).toBe(404);
    await a.agent.post('/api/restaurants').set(a.headers).send({ name: '有图的店', photos: [photo] });
    expect((await a.agent.delete(`/api/photos/${photo}`).set(a.headers)).status).toBe(409);
  });
  it('公开分享照片在撤销后不可访问', async () => {
    const { app } = fixture();
    const a = await owner(app);
    const photo = (await a.agent.post('/api/photos').set(a.headers).attach('photos', await png(), { filename: 'a.png', contentType: 'image/png' })).body.data[0].id;
    const r = (await a.agent.post('/api/restaurants').set(a.headers).send({ name: '店', photos: [photo] })).body.data;
    const s = (await a.agent.post('/api/shares').set(a.headers).send({ title: '图', restaurants: [r.id], period: { unit: 'forever' } })).body.data;
    expect(s.expiresAt).toBeNull();
    expect((await request(app).get(`/api/public/shares/${s.token}/photos/${photo}`)).status).toBe(200);
    await a.agent.delete(`/api/shares/${s.id}`).set(a.headers);
    expect((await request(app).get(`/api/public/shares/${s.token}/photos/${photo}`)).status).toBe(410);
  });
});

describe('选店与统计', () => {
  it('按人物分开计算，不把一人的喜欢当成所有人喜欢，条件不被放宽', async () => {
    const { app } = fixture();
    const a = await owner(app);
    const me = (await a.agent.get('/api/people')).body.data[0];
    const gf = (await a.agent.post('/api/people').set(a.headers).send({ name: '女朋友' })).body.data;
    const r = (await a.agent.post('/api/restaurants').set(a.headers).send({ name: '粥铺', tags: ['清淡'], budget: 60 })).body.data;
    const fish = (await a.agent.post('/api/dishes').set(a.headers).send({ name: '鱼片粥', restaurantId: r.id })).body.data;
    const ear = (await a.agent.post('/api/dishes').set(a.headers).send({ name: '凉拌木耳', restaurantId: r.id })).body.data;
    const meal = await a.agent.post('/api/meals').set(a.headers).send({
      restaurantId: r.id, date: '2026-09-01T12:00:00+08:00', mode: 'dine-in', amount: 12000, people: [me.id, gf.id], dishes: [fish.id, ear.id],
      opinions: [
        { personId: me.id, dishId: fish.id, feeling: 'like', again: true },
        { personId: gf.id, dishId: fish.id, feeling: 'like', again: true },
        { personId: gf.id, dishId: ear.id, feeling: 'dislike', again: false }
      ]
    });
    expect(meal.status).toBe(201);
    const found = (await a.agent.get(`/api/discover?tags=清淡&people=${me.id},${gf.id}`)).body.data.results[0];
    expect(found.mustOrder).toEqual(['鱼片粥']);
    expect(found.avoid[0]).toContain('女朋友不喜欢 凉拌木耳');
    expect(found.reasons[0]).toContain('都给过好评');
    expect((await a.agent.get('/api/discover?tags=辣')).body.data.results).toHaveLength(0);
    expect((await a.agent.get('/api/discover?budget=50')).body.data.results).toHaveLength(0);
    expect((await a.agent.get('/api/discover?mode=takeaway')).body.data.results).toHaveLength(0);
    const bad = await a.agent.post('/api/meals').set(a.headers).send({ restaurantId: r.id, date: '2026-09-02T12:00:00+08:00', people: [me.id], dishes: [], opinions: [{ personId: me.id, dishId: ear.id, feeling: 'like' }] });
    expect(bad.status).toBe(400);
    const stats = (await a.agent.get('/api/stats')).body.data;
    expect(stats.totalMeals).toBe(1);
    expect(stats.amount).toEqual({ total: 12000, withAmount: 1, missing: 0 });
    const exp = await a.agent.get('/api/export');
    expect(exp.headers['content-disposition']).toContain('attachment');
    expect(JSON.parse(exp.text).restaurants).toHaveLength(1);
  });
});
