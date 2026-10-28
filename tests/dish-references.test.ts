import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { getDishReferences, dishOriginSchema } from '../shared/dishReferences.js';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
describe('品牌公开菜品参考，不是完整菜单', () => {
  it('匹配品牌且不把近似品牌混入，明确部分覆盖和日期，13项来自图片原文', () => {
    const [source] = getDishReferences('79 号渔船海鲜饭店（岗厦店）');
    expect(source.names).toHaveLength(13);
    expect(source.names).toContain('海贝煲汁青石斑');
    expect(source.names).toContain('铁板啫北海灯照鲜鱿');
    expect(source.origin).toMatchObject({ scope: 'brand', coverage: 'partial', publishedAt: '2025-07-14', checkedAt: '2026-10-28' });
    expect(dishOriginSchema.safeParse(source.origin).success).toBe(true);
    expect(getDishReferences('79號漁船（深圳湾店）')).toHaveLength(1);
    expect(getDishReferences('179号渔船')).toEqual([]);
    expect(getDishReferences('其他餐馆')).toEqual([]);
  });
  it('接口需登录，查看参考不写菜；保存选择的菜保留来源，不导入整份清单', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wefood-dish-refs-')); const db = openDatabase(dir);
    cleanup.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
    const app = createApp({ db, dataDir: dir, setupToken: 'references-test-token', origins: ['http://localhost'], secureCookie: false });
    expect((await request(app).get('/dish-references')).status).toBe(404);
    expect((await request(app).get('/api/dish-references?name=79号渔船')).status).toBe(401);
    const agent = request.agent(app); const status = await agent.get('/api/auth/status');
    const auth = await agent.post('/api/auth/setup').set({ Origin: 'http://localhost', 'X-CSRF-Token': status.body.data.csrf }).send({ username: 'owner', password: 'references-password-1', setupToken: 'references-test-token' });
    const headers = { Origin: 'http://localhost', 'X-CSRF-Token': auth.body.data.csrf };
    const r = await agent.get('/api/dish-references?name=79号渔船');
    expect(r.status).toBe(200);
    expect(r.body.data.groups[0].names).toHaveLength(13);
    expect((await agent.get('/api/dishes')).body.data).toEqual([]);
    const restaurant = (await agent.post('/api/restaurants').set(headers).send({ name: '79号渔船' })).body.data;
    const dish = await agent.post('/api/dishes').set(headers).send({ name: '海贝煲汁青石斑', restaurantId: restaurant.id, origin: r.body.data.groups[0].origin });
    expect(dish.status).toBe(201);
    expect(dish.body.data.origin).toMatchObject({ coverage: 'partial', scope: 'brand' });
    expect((await agent.get('/api/dishes')).body.data).toHaveLength(1);
    const updated = await agent.put(`/api/dishes/${dish.body.data.id}`).set(headers).send({ note: '我觉得鲜嫩', version: 1 });
    expect(updated.body.data.origin).toEqual(dish.body.data.origin);
    expect((await agent.post('/api/dishes').set(headers).send({ name: '假完整菜单', restaurantId: restaurant.id, origin: { ...dish.body.data.origin, coverage: 'complete' } })).status).toBe(400);
  });
});
