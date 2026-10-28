import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { expiryFrom } from '../server/shares.js';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wefood-test-'));
  const db = openDatabase(dir);
  const app = createApp({ db, dataDir: dir, setupToken: 'test-setup-only', origins: ['http://localhost'], secureCookie: false });
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { app, db, agent: request.agent(app) };
}
async function setup(f: ReturnType<typeof fixture>) {
  const h = await f.agent.get('/api/auth/status');
  const headers = { Origin: 'http://localhost', 'X-CSRF-Token': h.body.data.csrf };
  const r = await f.agent.post('/api/auth/setup').set(headers).send({ username: 'tester', password: 'test-password-123', setupToken: 'test-setup-only' });
  expect(r.status).toBe(201);
  return { Origin: 'http://localhost', 'X-CSRF-Token': r.body.data.csrf };
}

describe('账号及记忆库', () => {
  it('多设备独立会话，当前设备退出不影响另一个设备', async () => {
    const f = fixture(); const a = await setup(f); const other = request.agent(f.app);
    const h = await other.get('/api/auth/status');
    const login = await other.post('/api/auth/login').set({ Origin: 'http://localhost', 'X-CSRF-Token': h.body.data.csrf }).send({ username: 'tester', password: 'test-password-123', device: '另一台手机' });
    expect(login.status).toBe(200);
    expect((await f.agent.post('/api/auth/logout').set(a)).status).toBe(200);
    expect((await f.agent.get('/api/auth/me')).status).toBe(401);
    expect((await other.get('/api/auth/me')).status).toBe(200);
  });
  it('拒绝跨站写入和非法关联，幂等保存并检测版本冲突', async () => {
    const f = fixture(); const headers = await setup(f);
    expect((await f.agent.post('/api/restaurants').set({ ...headers, Origin: 'https://evil.example' }).send({ name: '店' })).status).toBe(403);
    const restaurant = (await f.agent.post('/api/restaurants').set(headers).send({ name: '好吃的小店', tags: ['清淡'] })).body.data;
    const dish = (await f.agent.post('/api/dishes').set(headers).send({ name: '清蒸鱼', restaurantId: restaurant.id })).body.data;
    const people = (await f.agent.get('/api/people')).body.data;
    const meal = { restaurantId: restaurant.id, date: '2026-10-28T12:00:00+08:00', mode: 'dine-in', dishes: [dish.id], people: [people[0].id], opinions: [{ personId: people[0].id, dishId: dish.id, feeling: 'like', again: true, note: '鲜嫩' }], photos: [] };
    const r = await f.agent.post('/api/meals').set({ ...headers, 'Idempotency-Key': 'test-meal-save-key' }).send(meal);
    expect(r.status).toBe(201);
    expect((await f.agent.post('/api/meals').set({ ...headers, 'Idempotency-Key': 'test-meal-save-key' }).send(meal)).body.data.id).toBe(r.body.data.id);
    expect((await f.agent.get('/api/meals')).body.data).toHaveLength(1);
    expect((await f.agent.put(`/api/restaurants/${restaurant.id}`).set(headers).send({ name: '新名字', version: restaurant.version })).status).toBe(200);
    expect((await f.agent.put(`/api/restaurants/${restaurant.id}`).set(headers).send({ name: '覆盖', version: restaurant.version })).status).toBe(409);
    expect((await f.agent.post('/api/meals').set(headers).send({ ...meal, dishes: ['nonexistent'] })).status).toBe(404);
    expect((await f.agent.get('/api/meals')).body.data).toHaveLength(1);
  });
  it('独立账号不能读取、引用或分享别人的对象', async () => {
    const f = fixture(); const a = await setup(f);
    const restaurant = (await f.agent.post('/api/restaurants').set(a).send({ name: '私人的店' })).body.data;
    const invite = (await f.agent.post('/api/auth/invites').set(a).send({})).body.data;
    const other = request.agent(f.app); const h = await other.get('/api/auth/status');
    const signup = await other.post('/api/auth/register').set({ Origin: 'http://localhost', 'X-CSRF-Token': h.body.data.csrf }).send({ username: 'friend', password: 'other-password-123', invite: invite.token });
    expect(signup.status).toBe(201); const b = { Origin: 'http://localhost', 'X-CSRF-Token': signup.body.data.csrf };
    expect((await other.get(`/api/restaurants/${restaurant.id}`)).status).toBe(404);
    expect((await other.post('/api/dishes').set(b).send({ name: '菜', restaurantId: restaurant.id })).status).toBe(404);
    expect((await other.post('/api/shares').set(b).send({ title: '分享', restaurants: [restaurant.id], period: { unit: 'day', count: 7 } })).status).toBe(404);
    expect((await other.get('/api/restaurants')).body.data).toHaveLength(0);
  });
});

describe('公开快照', () => {
  it('按日历月计算期限，月末及永久正确', () => {
    expect(expiryFrom({ unit: 'month', count: 1 }, new Date('2026-01-31T10:00:00+08:00'))).toBe('2026-02-28T02:00:00.000Z');
    expect(expiryFrom({ unit: 'forever', count: 1 })).toBe(null);
  });
  it('快照独立且撤销后正文不可读', async () => {
    const f = fixture(); const headers = await setup(f);
    const r = (await f.agent.post('/api/restaurants').set(headers).send({ name: '值得推荐', note: '私人秘密', tags: ['清淡'] })).body.data;
    const share = (await f.agent.post('/api/shares').set(headers).send({ title: '我的推荐', restaurants: [r.id], period: { unit: 'day', count: 7 } })).body.data;
    const publicRead = await request(f.app).get(`/api/public/shares/${share.token}`);
    expect(publicRead.status).toBe(200);
    expect(JSON.stringify(publicRead.body)).not.toContain('私人秘密');
    await f.agent.put(`/api/restaurants/${r.id}`).set(headers).send({ name: '修改后的名字', version: r.version });
    expect((await request(f.app).get(`/api/public/shares/${share.token}`)).body.data.restaurants[0].name).toBe('值得推荐');
    await f.agent.delete(`/api/shares/${share.id}`).set(headers);
    expect((await request(f.app).get(`/api/public/shares/${share.token}`)).status).toBe(410);
  });
});
