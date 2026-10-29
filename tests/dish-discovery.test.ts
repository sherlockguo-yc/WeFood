import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { createDishCandidates } from '../server/dish-candidates.js';
import { isPublicAddress, publicUrl, parseMenuPage, parseSearchPage, normalizeCtripHit, parseAmap } from '../server/dish-discovery.js';
import { menuLines, recognizeMenu } from '../server/menu-ocr.js';
import { referencedPhotos } from '../server/media.js';
import { loadConfig } from '../server/config.js';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'wefood-auto-')), db = openDatabase(dir); cleanup.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); }); return { dir, db }; }
const name = '自动小馆（总店）', address = '小馆路100号';
const url = 'https://you.ctrip.com/food/test1/100.html';
const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { initialState: { restaurantDetail: { name, address, foods: ['清蒸鱼', '盐焗花螺'] } } } } })}</script>`;
const searchHtml = `<h3><a data-mdurl="${url}">自动小馆总店 携程</a></h3><h3><a data-mdurl="https://restaurant.example.com/menu">自动小馆菜单</a></h3>`;
const menu = '<title>自动小馆菜单</title><h2>菜单</h2><ul><li>清蒸鱼</li><li>红烧鱼</li></ul>';
const amap = { status: '1', pois: [{ id: 'B01234', name, address, tag: '清蒸鱼,蒜蓉生蚝,特色菜,海鲜盛宴' }] };
const response = (text: string) => new Response(text, { headers: { 'content-type': 'text/html' } });

describe('自动发现与地图特色菜', () => {
  it('解析国内和备用搜索真实链接，不跟随搜索跳转或私人URL', () => {
    const found = parseSearchPage(searchHtml); expect(found[0].url).toBe(url);
    const backup = parseSearchPage(`<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}">店铺</a>`);
    expect(backup[0].url).toBe(url);
    expect(normalizeCtripHit('https://gs.ctrip.com/html5/you/foods/fooddetail/26/100.html')).toBe('https://you.ctrip.com/food/26/100.html');
    expect(normalizeCtripHit('https://you.ctrip.com/food/a/100-dianping.html')).toBe('https://you.ctrip.com/food/a/100.html');
    expect(normalizeCtripHit('https://you.ctrip.com.evil.com/food/a/100.html')).toBeNull();
    for (const ip of ['127.0.0.1', '10.0.0.3', '172.16.2.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(() => publicUrl('https://127.0.0.1')).toThrow();
    expect(() => publicUrl('http://restaurant.example.com')).toThrow();
  });
  it('通用页仅明确菜单或MenuItem，不把文章描述/搜索摘要当菜名', () => {
    const group = parseMenuPage(menu, 'https://restaurant.example.com/menu', name, '2026-10-29');
    expect(group?.names).toEqual(['清蒸鱼', '红烧鱼']);
    expect(parseMenuPage('<title>自动小馆</title><p>听说他家的牛肉很好吃</p>', url, name, '2026-10-29')).toBeNull();
    expect(parseMenuPage('<title>别家店菜单</title><h2>菜单</h2><ul><li>菜</li></ul>', url, name, '2026-10-29')).toBeNull();
    const json = '<title>自动小馆</title><script type="application/ld+json">{"@type":"Menu","hasMenuItem":{"@type":"MenuItem","name":"豆腐"}}</script>';
    expect(parseMenuPage(json, url, name, '2026-10-29')?.names).toEqual(['豆腐']);
  });
  it('地图原名去除栏目词，配置读高德Web服务Key，服务失败明确提示', () => {
    expect(parseAmap(amap, '2026-10-29')[0].names).toEqual(['清蒸鱼', '蒜蓉生蚝']);
    expect(() => parseAmap({ status: '0', infocode: '10001' }, '2026-10-29')).toThrow('10001');
    const config = loadConfig({ WEFOOD_AMAP_KEY: 'fake-test-only' });
    expect(config.dishCandidates.amapKey).toBe('fake-test-only');
  });
  it('无需提供链接能自动找到携程，合并地图与通用页，歧义先确认，缓存不再请求', async () => {
    const { db } = fixture();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const u = String(input);
      if (u.includes('restapi.amap.com')) return new Response(JSON.stringify(amap), { headers: { 'content-type': 'application/json' } });
      if (u.includes('www.so.com')) return response(searchHtml);
      if (u === url) return response(html);
      return response(menu);
    });
    const service = createDishCandidates(db, { fetchImpl, amapKey: 'fake' });
    await service.query({ name, address }, 'owner'); expect(fetchImpl).not.toHaveBeenCalled();
    const first = await service.query({ name, address, discover: true }, 'owner');
    expect(first.candidates.map(c => c.name)).toEqual(expect.arrayContaining(['清蒸鱼', '盐焗花螺', '蒜蓉生蚝']));
    expect(first.choices).toContainEqual({ name, address: '', url: 'https://restaurant.example.com/menu' });
    const confirmed = await service.query({ name, address, confirmations: first.choices }, 'owner');
    expect(confirmed.candidates.map(c => c.name)).toContain('红烧鱼');
    expect(confirmed.candidates.find(c => c.name === '清蒸鱼')?.origins).toHaveLength(3);
    const count = fetchImpl.mock.calls.length;
    await service.query({ name, address, discover: true }, 'owner'); expect(fetchImpl).toHaveBeenCalledTimes(count);
    const another = await service.query({ name: '另一家店', address, discover: false }, 'owner'); expect(another.candidates).toEqual([]);
  });
  it('店铺坐标使用GCJ-02附近查询，不将腾讯ID当高德ID', async () => {
    const { db } = fixture(); const calls: string[] = [];
    const service = createDishCandidates(db, { amapKey: 'fake', fetchImpl: async input => {
      calls.push(String(input));
      return String(input).includes('restapi.amap.com') ? new Response(JSON.stringify(amap), { headers: { 'content-type': 'application/json' } }) : response('<html></html>');
    } });
    await service.query({ name, address, discover: true, location: { lng: 114.068588, lat: 22.533323 } }, 'owner');
    const mapUrl = new URL(calls.find(u => u.includes('restapi.amap.com'))!);
    expect(mapUrl.pathname).toBe('/v3/place/around');
    expect(mapUrl.searchParams.get('location')).toBe('114.068588,22.533323');
    expect(mapUrl.searchParams.get('radius')).toBe('1000');
  });
  it('过期搜索和地图缓存明确标记，失败刷新不能无限延长旧菜寿命', async () => {
    const { db } = fixture(); let now = new Date('2026-10-29T04:00:00Z'), broken = false;
    const service = createDishCandidates(db, { now: () => now, amapKey: 'fake', fetchImpl: async input => {
      if (broken) throw new TypeError('offline');
      return String(input).includes('restapi.amap.com') ? new Response(JSON.stringify(amap), { headers: { 'content-type': 'application/json' } }) : response('<html>无搜索结果</html>');
    } });
    const input = { name, address };
    expect((await service.query({ ...input, discover: true }, 'owner')).candidates).toHaveLength(2);
    now = new Date(now.getTime() + 2 * 86400_000);
    const stale = await service.query(input, 'owner');
    expect(stale.sources.some(s => s.status === 'stale')).toBe(true);
    broken = true;
    expect((await service.query({ ...input, discover: true }, 'owner')).candidates).toHaveLength(2);
    now = new Date(now.getTime() + 6 * 86400_000);
    expect((await service.query(input, 'owner')).candidates).toHaveLength(0);
    expect((await service.query({ ...input, discover: true }, 'owner')).candidates).toHaveLength(0);
  });
});

describe('菜单本地OCR', () => {
  it('真实中文图片在本地语言包识别，菜名建议去价格，仍需用户核对', async () => {
    const { dir } = fixture();
    const buffer = readFileSync(new URL('./fixtures/menu-ocr.png', import.meta.url));
    const result = await recognizeMenu(buffer, dir);
    expect(result.text.replace(/\s/g, '')).toContain('清蒸鱼');
    expect(menuLines(result.text)).toContain('清蒸鱼');
    expect(menuLines('菜单\n1.盐焗花螺 58元\n地址 小馆路')).toEqual(['盐焗花螺']);
  }, 90000);
  it('认证上传识别、原图私有、来源附件鉴权与引用保留、分享不公开OCR图', async () => {
    const { db, dir } = fixture();
    const app = createApp({ db, dataDir: dir, setupToken: 'ocr-setup-token-123', origins: ['http://localhost'], secureCookie: false, ocr: { recognize: async () => ({ text: '清蒸鱼 38元', confidence: 91 }) } });
    const image = await sharp({ create: { width: 200, height: 100, channels: 3, background: 'white' } }).png().toBuffer();
    expect((await request(app).post('/api/menu-ocr')).status).toBe(403);
    const agent = request.agent(app), status = await agent.get('/api/auth/status');
    const auth = await agent.post('/api/auth/setup').set({ Origin: 'http://localhost', 'X-CSRF-Token': status.body.data.csrf }).send({ username: 'ocr_owner', password: 'ocr-password-12345', setupToken: 'ocr-setup-token-123' });
    const headers = { Origin: 'http://localhost', 'X-CSRF-Token': auth.body.data.csrf };
    const recognized = await agent.post('/api/menu-ocr').set(headers).attach('menu', image, { filename: 'menu.png', contentType: 'image/png' });
    expect(recognized.status).toBe(200);
    const { photoId, checkedAt } = recognized.body.data;
    expect((await agent.get(`/api/photos/${photoId}`)).status).toBe(200);
    expect((await agent.get('/api/dishes')).body.data).toEqual([]);
    const restaurant = (await agent.post('/api/restaurants').set(headers).send({ name })).body.data;
    const origin = { publisher: '菜单照片', title: '菜单', photoId, publishedAt: null, checkedAt, scope: 'branch', coverage: 'partial' };
    const dish = await agent.post('/api/dishes').set(headers).send({ name: '清蒸鱼', restaurantId: restaurant.id, origin });
    expect(dish.status).toBe(201); expect(referencedPhotos(db).has(photoId)).toBe(true);
    expect((await agent.delete(`/api/photos/${photoId}`).set(headers)).status).toBe(409);
    expect((await agent.post('/api/dishes').set(headers).send({ name: '鱼', restaurantId: restaurant.id, origin: { ...origin, photoId: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
    const share = (await agent.post('/api/shares').set(headers).send({ title: '食记', restaurants: [restaurant.id], dishes: [dish.body.data.id], period: { unit: 'forever' } })).body.data;
    expect((await request(app).get(`/api/public/shares/${share.token}/photos/${photoId}`)).status).toBe(404);
    expect((await agent.post('/api/menu-ocr').set(headers).attach('menu', Buffer.from('fake'), { filename: 'fake.png', contentType: 'image/png' })).status).toBe(400);
  });
  it('无关媒体错误不能解除正在识别的并发锁', async () => {
    const { db, dir } = fixture(); let release!: () => void, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const app = createApp({ db, dataDir: dir, setupToken: 'ocr-lock-test-token', origins: ['http://localhost'], secureCookie: false, ocr: { recognize: async () => { started(); await wait; return { text: '清蒸鱼', confidence: 90 }; } } });
    const agent = request.agent(app), status = await agent.get('/api/auth/status');
    const auth = await agent.post('/api/auth/setup').set({ Origin: 'http://localhost', 'X-CSRF-Token': status.body.data.csrf }).send({ username: 'ocr_lock', password: 'ocr-lock-password-123', setupToken: 'ocr-lock-test-token' });
    const headers = { Origin: 'http://localhost', 'X-CSRF-Token': auth.body.data.csrf };
    const image = readFileSync(new URL('./fixtures/menu-ocr.png', import.meta.url));
    const first = agent.post('/api/menu-ocr').set(headers).attach('menu', image, { filename: 'menu.png', contentType: 'image/png' }).then(r => r);
    await ready;
    try {
      expect((await agent.get('/api/photos/not-found')).status).toBe(404);
      expect((await agent.post('/api/menu-ocr').set(headers).attach('menu', image, { filename: 'menu.png', contentType: 'image/png' })).status).toBe(429);
    } finally { release(); await first; }
  });
});
