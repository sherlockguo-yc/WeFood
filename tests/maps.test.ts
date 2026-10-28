import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/database.js';
import { createApp } from '../server/app.js';
import { createMaps, type MapsConfig } from '../server/maps.js';
import { clusterPoints, locationSchema } from '../shared/geo.js';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
function fixture(maps: MapsConfig = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wefood-maps-')); const db = openDatabase(dir);
  cleanup.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, dir, app: createApp({ db, dataDir: dir, setupToken: 'maps-setup-token', origins: ['http://localhost'], secureCookie: false, maps }) };
}
async function login(f: ReturnType<typeof fixture>) {
  const agent = request.agent(f.app); const h = await agent.get('/api/auth/status');
  const r = await agent.post('/api/auth/setup').set({ Origin: 'http://localhost', 'X-CSRF-Token': h.body.data.csrf }).send({ username: 'mapsuser', password: 'maps-password-123', setupToken: 'maps-setup-token' });
  return { agent, headers: { Origin: 'http://localhost', 'X-CSRF-Token': r.body.data.csrf } };
}
const point = { lat: 23.13, lng: 113.32, crs: 'GCJ-02' as const, source: 'manual' as const };
describe('位置与堂食', () => {
  it('新堂食需地址，外卖无需地址；旧无地址经历可修改备注', async () => {
    const f = fixture(); const { agent, headers } = await login(f);
    const r = (await agent.post('/api/restaurants').set(headers).send({ name: '没位置的老店' })).body.data;
    const body = { restaurantId: r.id, date: '2026-10-28T12:00:00+08:00', mode: 'dine-in' };
    expect((await agent.post('/api/meals').set(headers).send(body)).status).toBe(400);
    expect((await agent.post('/api/meals').set(headers).send({ ...body, mode: 'takeaway' })).status).toBe(201);
    const now = new Date().toISOString();
    f.db.prepare('INSERT INTO meals VALUES (?,?,?,?,?,?)').run('oldmeal', (await agent.get('/api/auth/me')).body.data.user.id, 1, now, now, JSON.stringify({ ...body, people: [], dishes: [], photos: [] }));
    expect((await agent.put('/api/meals/oldmeal').set(headers).send({ note: '补记', version: 1 })).status).toBe(200);
    const updated = await agent.put(`/api/restaurants/${r.id}`).set(headers).send({ address: '体育西路 100 号', location: point, version: 1 });
    expect(updated.body.data.location).toEqual(point);
    expect((await agent.post('/api/meals').set(headers).send(body)).status).toBe(201);
    expect((await agent.put(`/api/restaurants/${r.id}`).set(headers).send({ location: { ...point, lat: 100 }, version: 2 })).status).toBe(400);
  });
  it('位置严格标记坐标系，密集点聚合，高缩放展开', () => {
    expect(locationSchema.safeParse({ ...point, crs: 'WGS-84' }).success).toBe(false);
    expect(locationSchema.safeParse({ ...point, lat: NaN }).success).toBe(false);
    const points = [{ id: 'a', ...point }, { id: 'b', ...point, lng: point.lng + .001 }];
    expect(clusterPoints(points, 8)).toHaveLength(1);
    expect(clusterPoints(points, 19)).toHaveLength(2);
  });
  it('无密钥时明确返回未配置，查询接口需认证', async () => {
    const f = fixture(); const { agent } = await login(f);
    expect((await request(f.app).get('/api/maps/config')).status).toBe(401);
    expect((await agent.get('/api/maps/config')).body.data).toMatchObject({ jsKey: '', searchEnabled: false });
  });
});
describe('腾讯适配器（模拟响应，不是真实上游验证）', () => {
  it('只向固定上游发送地理字段，规范化 POI；按北京时间配额持久化', async () => {
    const f = fixture();
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => new Response(JSON.stringify({ status: 0, count: 1, data: [{ id: 'poi1', title: '真实字段样本', address: '路 1 号', location: point, category: '餐饮' }] })));
    const maps = createMaps({ db: f.db, key: 'server-only', sk: 'sign-only', dailyLimit: 2, userDailyLimit: 1, fetchImpl, now: () => new Date('2026-10-28T23:00:00+08:00') });
    const r = await maps.search({ keyword: '粥', region: '广州' }, 'owner');
    expect(r.places[0]).toMatchObject({ name: '真实字段样本', location: { crs: 'GCJ-02', source: 'tencent', providerId: 'poi1' } });
    const url = new URL(fetchImpl.mock.calls[0]?.[0] as unknown as string);
    expect(url.origin).toBe('https://apis.map.qq.com');
    expect(url.searchParams.get('boundary')).toBe('region(广州,0)');
    expect(url.searchParams.get('sig')).toHaveLength(32);
    await expect(maps.search({ keyword: '粥', region: '广州' }, 'owner')).rejects.toMatchObject({ code: 'MAPS_QUOTA' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('逆编码保留点击坐标，GPS 转换使用 type=1，异常不泄露秘密', async () => {
    const f = fixture();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes('/geocoder/') ? { status: 0, result: { address: '路 2 号', ad_info: { location: { lat: 10, lng: 10 } } } } : { status: 0, locations: [{ lat: 23.131, lng: 113.321 }] })));
    const maps = createMaps({ db: f.db, key: 'private-server-key', fetchImpl });
    expect((await maps.reverse({ lat: 23.13, lng: 113.32 }, 'owner')).location).toMatchObject({ lat: 23.13, lng: 113.32 });
    expect((await maps.translate({ lat: 23.13, lng: 113.32 }, 'owner')).lat).toBe(23.131);
    expect(new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams.get('type')).toBe('1');
    const bad = createMaps({ db: f.db, key: 'private-server-key', fetchImpl: async () => { throw new Error('private-server-key'); } });
    await expect(bad.search({ keyword: '店', region: '广州' }, 'owner')).rejects.toMatchObject({ message: '腾讯地图连接失败，请稍后再试' });
  });
  it('浏览器仅获取 JS Key，不泄露服务端 Key/SK；跨站不能消耗额度', async () => {
    const f = fixture({ jsKey: 'public-js-test', key: 'private-web-key', sk: 'private-sign-key' });
    const { agent, headers } = await login(f);
    const config = await agent.get('/api/maps/config');
    expect(config.body.data.jsKey).toBe('public-js-test');
    expect(JSON.stringify(config.body)).not.toMatch(/private-web-key|private-sign-key/);
    expect((await agent.post('/api/maps/search').set({ ...headers, Origin: 'https://evil.example' }).send({ keyword: '店', region: '广州' })).status).toBe(403);
    expect((f.db.prepare('SELECT count(*) n FROM map_usage').get() as { n: number }).n).toBe(0);
  });
  it('超时及无效上游响应明确失败，不自动重试', async () => {
    const f = fixture();
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')))));
    const maps = createMaps({ db: f.db, key: 'test-only', fetchImpl, timeoutMs: 10 });
    await expect(maps.search({ keyword: '店', region: '广州' }, 'owner')).rejects.toMatchObject({ code: 'MAPS_TIMEOUT' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const malformed = createMaps({ db: f.db, key: 'test-only', fetchImpl: async () => new Response(JSON.stringify({ status: 0, count: 1, data: [{ id: 'x', title: '店', location: { lat: 100, lng: 0 } }] })) });
    await expect(malformed.search({ keyword: '店', region: '广州' }, 'owner')).rejects.toMatchObject({ code: 'MAPS_RESPONSE' });
  });
  it('配额重建适配器后仍有效，北京时间次日重置', async () => {
    const f = fixture(); let clock = new Date('2026-10-28T23:59:59+08:00');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 0, count: 0, data: [] })));
    const opts = { db: f.db, key: 'test-only', fetchImpl, userDailyLimit: 1, now: () => clock };
    await createMaps(opts).search({ keyword: '店', region: '广州' }, 'owner');
    await expect(createMaps(opts).search({ keyword: '店', region: '广州' }, 'owner')).rejects.toMatchObject({ code: 'MAPS_QUOTA' });
    clock = new Date('2026-10-29T00:00:01+08:00');
    await expect(createMaps(opts).search({ keyword: '店', region: '广州' }, 'owner')).resolves.toMatchObject({ places: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
