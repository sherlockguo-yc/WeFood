import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FoodDB } from './database.js';
import { coordinatesSchema, type FoodLocation } from '../shared/geo.js';
import { fail, HttpError } from './errors.js';

export type MapsConfig = { jsKey?: string; key?: string; sk?: string; dailyLimit?: number; userDailyLimit?: number };
type Options = MapsConfig & { db: FoodDB; fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number };
export type Place = { name: string; address: string; category: string; location: FoodLocation };
const rowSchema = z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(120), address: z.string().max(300).default(''), category: z.string().max(200).default(''), location: coordinatesSchema });
const searchSchema = z.object({ keyword: z.string().trim().min(1).max(96), region: z.string().trim().min(1).max(80).regex(/^[^(),\u0000-\u001f]+$/), page: z.number().int().min(1).max(20).default(1) }).strict();
const normalize = (raw: unknown): Place => {
  const r = rowSchema.safeParse(raw);
  if (!r.success) fail(502, 'MAPS_RESPONSE', '地图返回的地点资料不完整，请换个关键词');
  return { name: r.data.title, address: r.data.address, category: r.data.category, location: { ...r.data.location, crs: 'GCJ-02', source: 'tencent', providerId: r.data.id } };
};

export function createMaps(options: Options) {
  const { db } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const daily = options.dailyLimit ?? 100, perUser = options.userDailyLimit ?? 20;
  db.exec('CREATE TABLE IF NOT EXISTS map_usage (day TEXT NOT NULL, owner_id TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,owner_id))');
  let active = 0;
  const consume = (owner: string) => db.transaction(() => {
    const day = new Date(now().getTime() + 8 * 3600_000).toISOString().slice(0, 10);
    const total = (db.prepare('SELECT COALESCE(SUM(count),0) n FROM map_usage WHERE day=?').get(day) as { n: number }).n;
    const count = (db.prepare('SELECT count FROM map_usage WHERE day=? AND owner_id=?').get(day, owner) as { count: number } | undefined)?.count ?? 0;
    if (total >= daily || count >= perUser) fail(429, 'MAPS_QUOTA', '已达到本服务今日地图查询预算，请次日再试');
    db.prepare('INSERT INTO map_usage VALUES (?,?,1) ON CONFLICT(day,owner_id) DO UPDATE SET count=count+1').run(day, owner);
    db.prepare('DELETE FROM map_usage WHERE day<?').run(new Date(now().getTime() - 30 * 86400_000).toISOString().slice(0, 10));
  })();

  async function upstream(path: string, params: Record<string, string>, owner: string): Promise<Record<string, unknown>> {
    if (!options.key?.trim()) fail(503, 'MAPS_CONFIG', '尚未配置腾讯地图 WebService Key，可先手填地址');
    if (active >= 2) fail(429, 'MAPS_BUSY', '地图查询正在处理中，请稍后再试');
    consume(owner); active++;
    const entries = Object.entries({ ...params, key: options.key }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const url = new URL(path, 'https://apis.map.qq.com');
    for (const [k, v] of entries) url.searchParams.set(k, v);
    if (options.sk) url.searchParams.set('sig', createHash('md5').update(`${path}?${entries.map(([k, v]) => `${k}=${v}`).join('&')}${options.sk}`).digest('hex'));
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
      const res = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json', 'x-legacy-url-decode': 'no' } });
      if (!res.ok) { await res.body?.cancel(); fail(res.status === 429 ? 429 : 502, 'MAPS_UPSTREAM', '腾讯地图暂时不可用，请稍后再试'); }
      if (Number(res.headers.get('content-length')) > 2 * 1024 * 1024) { await res.body?.cancel(); fail(502, 'MAPS_RESPONSE', '地图返回资料过大'); }
      const reader = res.body?.getReader(); if (!reader) fail(502, 'MAPS_RESPONSE', '地图未返回资料');
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); fail(502, 'MAPS_RESPONSE', '地图返回资料过大'); } chunks.push(value); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      if (!data || !Number.isInteger(data.status)) fail(502, 'MAPS_RESPONSE', '地图返回格式异常');
      if (data.status !== 0) fail(503, 'MAPS_UPSTREAM', '腾讯地图拒绝本次查询，请检查权限、签名与额度');
      return data;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (controller.signal.aborted) fail(504, 'MAPS_TIMEOUT', '腾讯地图查询超时，请稍后再试');
      fail(502, 'MAPS_UPSTREAM', '腾讯地图连接失败，请稍后再试');
    } finally { clearTimeout(timer); active--; }
  }
  return {
    async search(input: unknown, owner: string) {
      const p = searchSchema.parse(input);
      if (Buffer.byteLength(p.keyword) > 96) fail(400, 'VALIDATION', '搜索关键词过长');
      const d = await upstream('/ws/place/v1/search', { keyword: p.keyword, boundary: `region(${p.region},0)`, page_size: '10', page_index: String(p.page) }, owner);
      if (!Array.isArray(d.data) || d.data.length > 10 || !Number.isSafeInteger(d.count) || Number(d.count) < 0) fail(502, 'MAPS_RESPONSE', '地图地点列表格式异常');
      return { places: d.data.map(normalize), hasMore: p.page * 10 < Math.min(Number(d.count), 200) };
    },
    async detail(input: unknown, owner: string) {
      const p = z.object({ providerId: z.string().min(1).max(200).regex(/^[^;,]+$/) }).strict().parse(input);
      const d = await upstream('/ws/place/v1/detail', { id: p.providerId }, owner);
      const rows = Array.isArray(d.data) ? d.data : d.result ? [d.result] : [];
      if (rows.length !== 1) fail(502, 'MAPS_RESPONSE', '地图地点详情格式异常');
      const place = normalize(rows[0]);
      if (place.location.providerId !== p.providerId) fail(502, 'MAPS_RESPONSE', '地图地点标识不一致');
      return place;
    },
    async reverse(input: unknown, owner: string) {
      const p = coordinatesSchema.strict().parse(input);
      const d = await upstream('/ws/geocoder/v1/', { location: `${p.lat},${p.lng}` }, owner);
      const result = z.object({ address: z.string().max(300) }).safeParse(d.result);
      if (!result.success) fail(502, 'MAPS_RESPONSE', '地图未能解析地址，可以手动填写');
      return { address: result.data.address, location: { ...p, crs: 'GCJ-02', source: 'manual' } as FoodLocation };
    },
    async translate(input: unknown, owner: string) {
      const p = coordinatesSchema.strict().parse(input);
      const d = await upstream('/ws/coord/v1/translate', { locations: `${p.lat},${p.lng}`, type: '1' }, owner);
      const result = z.array(coordinatesSchema).length(1).safeParse(d.locations);
      if (!result.success) fail(502, 'MAPS_RESPONSE', '定位坐标转换失败，请在地图上手动浏览');
      return { ...result.data[0], crs: 'GCJ-02' as const };
    }
  };
}

export function mapsRouter(db: FoodDB, config: MapsConfig = {}, fetchImpl?: typeof fetch) {
  const router = Router(); const maps = createMaps({ db, ...config, fetchImpl });
  router.get('/config', (_req, res) => res.json({ data: { jsKey: config.jsKey ?? '', searchEnabled: !!config.key?.trim(), provider: 'tencent' } }));
  for (const operation of ['search', 'detail', 'reverse', 'translate'] as const) router.post(`/${operation}`, async (req, res) => res.json({ data: await maps[operation](req.body, req.identity!.id) }));
  return router;
}
