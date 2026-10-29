import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { getDishReferences, dishOriginSchema, aggregateDishCandidates } from '../shared/dishReferences.js';
import { createDishCandidates, ctripSourceUrl, parseCtripPage, GANGXIA_SOURCE } from '../server/dish-candidates.js';

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
    const duplicate = await agent.post('/api/dishes').set(headers).send({ name: '海贝煲汁 青石斑', restaurantId: restaurant.id, note: '不能覆盖原菜' });
    expect(duplicate.body.data.id).toBe(dish.body.data.id);
    expect(duplicate.body.data.note).toBe('我觉得鲜嫩');
    expect((await agent.get('/api/dishes')).body.data).toHaveLength(1);
    const variant = await agent.post('/api/dishes').set(headers).send({ name: dish.body.data.name, restaurantId: restaurant.id, variant: '大份' });
    expect(variant.body.data.id).not.toBe(dish.body.data.id);
  });
});

const sourceName = '79号渔船海鲜饭店(岗厦店)';
const sourceAddress = '深圳市彩田路福建大厦A座裙楼1-3层（近岗厦地铁站E口）';
const sourceFoods = ['三叔烤大罗虾', '椒盐大虾菇', '蒜酱烤波龙', '避风塘炒石岩蟹', '百香果蒸中鲍鱼', '蒜蓉粉丝蒸大元贝', '蒜蓉烤生蚝', '避风塘炒蟹', '椒盐九肚鱼', '海胆炒饭', '渔夫蒸珍珠斑', '海皇汤', '花螺', '中鲍鱼', '大虾菇', '圳品超罗虾', '蒜蓉炒有机红薯苗', '藕尖炒黄牛肉', '清蒸珍珠斑鱼', '姜葱炒竹蛏', '海胆生煎包', '海鲜炒饭小份', '酱爆大连蛏子王', '清蒸蟹脚'];
const pageHtml = (name = sourceName, address = sourceAddress, foods = sourceFoods) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialState: { restaurantDetail: { name, address, foods }, moreRestaurantList: [{ name: '别家店', foods: ['别家店的菜'] }] } } } })}</script>`;
function candidateDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wefood-candidates-')), db = openDatabase(dir);
  cleanup.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, db };
}
const htmlResponse = (html = pageHtml()) => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('多渠道菜品候选', () => {
  it('按真实结构只提取本店24项，合并品牌为35项，保留全部原文证据和未知日期', () => {
    const group = parseCtripPage(pageHtml(), GANGXIA_SOURCE, '2026-10-29');
    expect(group.names).toHaveLength(24);
    const items = aggregateDishCandidates([...getDishReferences('79号渔船'), group]);
    expect(items).toHaveLength(35);
    expect(items.some(x => x.name === '别家店的菜')).toBe(false);
    expect(items.find(x => x.name === '海胆生煎包')?.origins).toHaveLength(2);
    expect(items.find(x => x.name === '海胆生煎包')?.origins[0]).toMatchObject({ scope: 'branch', publishedAt: null, rawName: '海胆生煎包', restaurantName: sourceName });
    const conservative = aggregateDishCandidates([{ ...group, names: [' 盐焗花螺 ', '盐焗 花螺', '花螺', '红烧鱼', '清蒸鱼', '清蒸鱼（大份）'] }]);
    expect(conservative).toHaveLength(5);
    expect(dishOriginSchema.safeParse({ ...group.origin, evidence: [getDishReferences('79号渔船')[0].origin] }).success).toBe(true);
    expect(() => parseCtripPage('<html>登录</html>', GANGXIA_SOURCE, '2026-10-29')).toThrow();
  });
  it('仅点击才抓取，同名同地址自动匹配，缓存和同URL并发复用', async () => {
    const { db } = candidateDb(); const fetchImpl = vi.fn(async () => htmlResponse());
    const service = createDishCandidates(db, { fetchImpl });
    const input = { name: sourceName, address: sourceAddress, sourceUrl: GANGXIA_SOURCE };
    expect((await service.query(input, 'owner')).candidates).toHaveLength(13);
    expect(fetchImpl).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([service.query({ ...input, load: true }, 'owner'), service.query({ ...input, load: true }, 'owner')]);
    expect(a.candidates).toHaveLength(35); expect(b.candidates).toHaveLength(35);
    await service.query({ ...input, load: true }, 'owner');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual([GANGXIA_SOURCE, expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })]);
  });
  it('其他店也可用公开链接，匹配歧义必须确认，不把岗厦菜混入其他分店', async () => {
    const { db } = candidateDb(); const service = createDishCandidates(db, { fetchImpl: async () => htmlResponse() });
    const input = { name: '79号渔船（深圳湾店）', address: '其他地址', sourceUrl: GANGXIA_SOURCE, load: true };
    const pending = await service.query(input, 'owner');
    expect(pending.pending).toEqual({ name: sourceName, address: sourceAddress, url: GANGXIA_SOURCE });
    expect(pending.candidates).toHaveLength(13);
    expect((await service.query({ ...input, confirm: pending.pending }, 'owner')).candidates).toHaveLength(35);
    const generic = createDishCandidates(db, { fetchImpl: async () => htmlResponse(pageHtml('普通小馆（总店）', '小馆路100号', ['豆腐', '清蒸鱼'])) });
    const other = await generic.query({ name: '普通小馆（总店）', address: '小馆路100号', sourceUrl: 'https://you.ctrip.com/food/test1/100.html', load: true }, 'owner');
    expect(other.candidates.map(x => x.name)).toEqual(['豆腐', '清蒸鱼']);
  });
  it('过期缓存降级、失败退避、超过7天不再展示分店旧菜', async () => {
    const { db } = candidateDb(); let now = new Date('2026-10-29T04:00:00Z'), broken = false;
    const fetchImpl = vi.fn(async () => broken ? new Response('拒绝', { status: 403 }) : htmlResponse());
    const service = createDishCandidates(db, { fetchImpl, now: () => now });
    const input = { name: sourceName, address: sourceAddress, sourceUrl: GANGXIA_SOURCE, load: true };
    await service.query(input, 'owner'); broken = true; now = new Date(now.getTime() + 2 * 86400_000);
    const fallback = await service.query(input, 'owner');
    expect(fallback.candidates).toHaveLength(35); expect(fallback.sources[1].status).toBe('stale');
    await service.query(input, 'owner'); expect(fetchImpl).toHaveBeenCalledTimes(2);
    now = new Date(now.getTime() + 6 * 86400_000);
    expect((await service.query(input, 'owner')).candidates).toHaveLength(13);
  });
  it('拒绝危险URL、重定向和过大响应，额度超出仍保留品牌候选', async () => {
    const { db } = candidateDb();
    for (const url of ['http://you.ctrip.com/food/a/1.html', 'https://you.ctrip.com.evil.com/food/a/1.html', 'https://user@you.ctrip.com/food/a/1.html', 'https://127.0.0.1/food/a/1.html', 'https://you.ctrip.com:444/food/a/1.html', 'https://you.ctrip.com/../api']) expect(() => ctripSourceUrl(url)).toThrow();
    const fetchImpl = vi.fn(async () => new Response('x', { headers: { 'content-type': 'text/html', 'content-length': String(5 * 1024 * 1024) } }));
    const service = createDishCandidates(db, { fetchImpl, userDailyLimit: 1 });
    const result = await service.query({ name: '79号渔船', sourceUrl: GANGXIA_SOURCE, load: true }, 'owner');
    expect(result.sources[1].status).toBe('failed'); expect(result.candidates).toHaveLength(13);
    const limit = await service.query({ name: '79号渔船', sourceUrl: 'https://you.ctrip.com/food/a/2.html', load: true }, 'owner');
    expect(limit.sources[1].message).toContain('额度'); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('超时中断、流式大小上限及空菜品状态均可降级', async () => {
    const { db } = candidateDb();
    const slow: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new TypeError('aborted')), { once: true }); });
    const service = createDishCandidates(db, { fetchImpl: slow, timeoutMs: 10 });
    const timeout = await service.query({ name: '79号渔船', sourceUrl: 'https://you.ctrip.com/food/a/3.html', load: true }, 'owner');
    expect(timeout.sources[1].message).toContain('超时'); expect(timeout.candidates).toHaveLength(13);
    const large = createDishCandidates(db, { fetchImpl: async () => new Response('a'.repeat(4 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } }) });
    expect((await large.query({ name: '79号渔船', sourceUrl: 'https://you.ctrip.com/food/a/4.html', load: true }, 'owner')).sources[1].message).toContain('过大');
    const empty = createDishCandidates(db, { fetchImpl: async () => htmlResponse(pageHtml(sourceName, sourceAddress, [])) });
    const result = await empty.query({ name: sourceName, address: sourceAddress, sourceUrl: 'https://you.ctrip.com/food/a/5.html', load: true }, 'owner');
    expect(result.sources[1].status).toBe('empty'); expect(result.candidates).toHaveLength(13);
  });
  it('API认证、账号绑定隔离、多来源保存及公开分享不泄漏来源', async () => {
    const { db, dir } = candidateDb();
    const app = createApp({ db, dataDir: dir, setupToken: 'candidates-test-token', origins: ['http://localhost'], secureCookie: false, dishCandidates: { fetchImpl: async () => htmlResponse() } });
    expect((await request(app).get('/api/dish-candidates')).status).toBe(401);
    const agent = request.agent(app), status = await agent.get('/api/auth/status');
    const auth = await agent.post('/api/auth/setup').set({ Origin: 'http://localhost', 'X-CSRF-Token': status.body.data.csrf }).send({ username: 'candidate_owner', password: 'candidates-password-1', setupToken: 'candidates-test-token' });
    const headers = { Origin: 'http://localhost', 'X-CSRF-Token': auth.body.data.csrf };
    const restaurant = (await agent.post('/api/restaurants').set(headers).send({ name: '79号渔船（岗厦店）', address: sourceAddress })).body.data;
    expect((await agent.post('/api/dish-candidates').send({ restaurantId: restaurant.id, load: true })).status).toBe(403);
    expect((await agent.get('/api/dish-candidates').query({ restaurantId: 'someone-else' })).status).toBe(404);
    const pending = (await agent.post('/api/dish-candidates').set(headers).send({ restaurantId: restaurant.id, load: true })).body.data;
    expect(pending.pending.name).toBe(sourceName);
    const ready = (await agent.post('/api/dish-candidates').set(headers).send({ restaurantId: restaurant.id, load: true, confirm: pending.pending })).body.data;
    expect(ready.candidates).toHaveLength(35);
    expect((await agent.get('/api/dish-candidates').query({ restaurantId: restaurant.id })).body.data.candidates).toHaveLength(35);
    const match = ready.candidates.find((x: { name: string }) => x.name === '海胆生煎包');
    const created = await agent.post('/api/dishes').set(headers).send({ restaurantId: restaurant.id, name: match.name, origin: { ...match.origins[0], evidence: match.origins } });
    expect(created.status).toBe(201); expect(created.body.data.origin.evidence).toHaveLength(2);
    expect((await agent.get('/api/dishes')).body.data).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) n FROM dish_source_bindings WHERE owner_id=?').get('different-owner')).toEqual({ n: 0 });
    const share = await agent.post('/api/shares').set(headers).send({ title: '来源隔离验证', restaurants: [restaurant.id], dishes: [created.body.data.id], period: { unit: 'forever' } });
    expect(share.status).toBe(201);
    const snapshot = (await request(app).get(`/api/public/shares/${share.body.data.token}`)).body.data;
    expect(snapshot.restaurants[0].dishes).toHaveLength(1);
    expect(snapshot.restaurants[0].dishes[0]).not.toHaveProperty('origin');
    expect(JSON.stringify(snapshot)).not.toContain('you.ctrip.com');
    await agent.put(`/api/restaurants/${restaurant.id}`).set(headers).send({ version: restaurant.version, address: '另一分店地址' });
    const changed = (await agent.get('/api/dish-candidates').query({ restaurantId: restaurant.id })).body.data;
    expect(changed.pending).toBeDefined(); expect(changed.candidates).toHaveLength(13);
  });
});
