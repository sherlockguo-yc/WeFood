import { Router } from 'express';
import { z } from 'zod';
import type { FoodDB } from './database.js';
import { createStore } from './library.js';
import { fail } from './errors.js';
import { aggregateDishCandidates, getDishReferences, normalizeDishName, type DishReference, type DishCandidateResult, type SourcePlace } from '../shared/dishReferences.js';

export const GANGXIA_SOURCE = 'https://you.ctrip.com/food/ctripyouyoustar26/21660849.html';
export function ctripSourceUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { return fail(400, 'SOURCE_URL', '请输入携程公开餐厅页面的 HTTPS 链接'); }
  if (url.protocol !== 'https:' || url.hostname !== 'you.ctrip.com' || url.port || url.username || url.password || !/^\/food\/[a-zA-Z0-9]+\/\d+\.html$/.test(url.pathname)) fail(400, 'SOURCE_URL', '目前仅支持 you.ctrip.com 的公开餐厅详情链接，不支持登录页或其他网站');
  return `${url.origin}${url.pathname}`;
}
const pageSchema = z.object({
  name: z.string().trim().min(1).max(120), address: z.string().trim().min(1).max(300),
  foods: z.array(z.string().trim().min(1).max(120)).max(500)
});
export function parseCtripPage(html: string, url: string, checkedAt: string): DishReference {
  const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('未找到本店结构化菜品资料，可能需要登录或页面结构已变化');
  let raw: unknown;
  try { raw = JSON.parse(script[1]); } catch { throw new Error('公开页面资料格式异常'); }
  const result = z.object({ props: z.object({ pageProps: z.object({ initialState: z.object({ restaurantDetail: pageSchema }) }) }) }).safeParse(raw);
  if (!result.success) throw new Error('本店名称、地址或菜品列表缺失，未导入推荐餐馆或评论');
  const page = result.data.props.pageProps.initialState.restaurantDetail;
  return { id: url, brand: page.name, names: page.foods, origin: { publisher: '携程旅行', title: `${page.name} · 本店特色美食`, url, publishedAt: null, checkedAt, scope: 'branch', coverage: 'partial', restaurantName: page.name, address: page.address } };
}
const SAME_DAY = 86400_000;
const canonicalShop = (name: string) => normalizeDishName(name).replace(/號/g, '号').replace(/漁/g, '渔');
const exactPlace = (name: string, address: string, group: DishReference) => canonicalShop(name) === canonicalShop(group.brand) && normalizeDishName(address) === normalizeDishName(group.origin.address ?? '') && !!address.trim();
type CacheRow = { data: string | null; fetched_at: number; retry_at: number; error: string };
export type CandidateOptions = { fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number; dailyLimit?: number; userDailyLimit?: number };

export function createDishCandidates(db: FoodDB, options: CandidateOptions = {}) {
  db.exec('CREATE TABLE IF NOT EXISTS dish_candidate_cache (url TEXT PRIMARY KEY, data TEXT, fetched_at INTEGER NOT NULL, retry_at INTEGER NOT NULL, error TEXT NOT NULL); CREATE TABLE IF NOT EXISTS dish_source_bindings (owner_id TEXT NOT NULL, restaurant_id TEXT NOT NULL, url TEXT NOT NULL, source_name TEXT NOT NULL, source_address TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(owner_id,restaurant_id)); CREATE TABLE IF NOT EXISTS dish_source_usage (day TEXT NOT NULL, owner_id TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,owner_id))');
  const store = createStore(db), clock = options.now ?? (() => new Date());
  const inFlight = new Map<string, Promise<CacheRow>>();
  const cacheKey = (url: string) => `ctrip-v1:${url}`;
  const cache = (url: string) => db.prepare('SELECT * FROM dish_candidate_cache WHERE url=?').get(cacheKey(url)) as CacheRow | undefined;
  function consume(owner: string) {
    db.transaction(() => {
      const day = new Date(clock().getTime() + 8 * 3600_000).toISOString().slice(0, 10);
      const total = (db.prepare('SELECT COALESCE(SUM(count),0) n FROM dish_source_usage WHERE day=?').get(day) as { n: number }).n;
      const used = (db.prepare('SELECT count FROM dish_source_usage WHERE day=? AND owner_id=?').get(day, owner) as { count: number } | undefined)?.count ?? 0;
      if (total >= (options.dailyLimit ?? 100) || used >= (options.userDailyLimit ?? 20)) throw new Error('今日公开菜品获取额度已用完，请次日重试');
      db.prepare('INSERT INTO dish_source_usage VALUES (?,?,1) ON CONFLICT(day,owner_id) DO UPDATE SET count=count+1').run(day, owner);
      db.prepare('DELETE FROM dish_source_usage WHERE day<?').run(new Date(clock().getTime() - 30 * SAME_DAY).toISOString().slice(0, 10));
      db.prepare('DELETE FROM dish_candidate_cache WHERE fetched_at<? AND retry_at<?').run(clock().getTime() - 7 * SAME_DAY, clock().getTime());
    })();
  }
  async function load(url: string, owner: string): Promise<CacheRow> {
    const cached = cache(url), now = clock().getTime();
    if (cached && (cached.retry_at > now || (cached.data && now - cached.fetched_at < SAME_DAY))) return cached;
    const existing = inFlight.get(url); if (existing) return existing;
    if (inFlight.size >= 2) throw new Error('公开菜品获取繁忙，请稍后重试');
    consume(owner);
    const promise = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
      try {
        const response = await (options.fetchImpl ?? fetch)(url, { redirect: 'error', signal: controller.signal, headers: { Accept: 'text/html' } });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); throw new Error('公开页面暂不可读，不会绕过登录或访问限制'); }
        if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) { await response.body?.cancel(); throw new Error('公开页面过大，已停止读取'); }
        const reader = response.body?.getReader(); if (!reader) throw new Error('公开页面没有正文');
        const chunks: Uint8Array[] = []; let bytes = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('公开页面过大，已停止读取'); } chunks.push(value); }
        const group = parseCtripPage(Buffer.concat(chunks).toString('utf8'), url, clock().toISOString().slice(0, 10));
        const row: CacheRow = { data: JSON.stringify(group), fetched_at: clock().getTime(), retry_at: 0, error: '' };
        db.prepare('INSERT OR REPLACE INTO dish_candidate_cache VALUES (?,?,?,?,?)').run(cacheKey(url), row.data, row.fetched_at, row.retry_at, row.error);
        return row;
      } catch (error) {
        const text = controller.signal.aborted ? '公开菜品获取超时，请稍后重试' : error instanceof Error && !['TypeError', 'SyntaxError'].includes(error.name) ? error.message : '公开页面连接失败，请稍后重试';
        const row: CacheRow = { data: cached?.data ?? null, fetched_at: cached?.fetched_at ?? 0, retry_at: clock().getTime() + 60_000, error: text };
        db.prepare('INSERT OR REPLACE INTO dish_candidate_cache VALUES (?,?,?,?,?)').run(cacheKey(url), row.data, row.fetched_at, row.retry_at, row.error);
        return row;
      } finally { clearTimeout(timer); }
    })();
    inFlight.set(url, promise);
    try { return await promise; } finally { inFlight.delete(url); }
  }
  const inputSchema = z.object({ restaurantId: z.string().max(100).default(''), name: z.string().trim().max(120).default(''), address: z.string().trim().max(300).default(''), sourceUrl: z.string().trim().max(2000).default(''), load: z.boolean().default(false), bind: z.boolean().default(false), confirm: z.object({ name: z.string().max(120), address: z.string().max(300), url: z.string().max(2000) }).optional() }).strict();
  return {
    async query(raw: unknown, owner: string): Promise<DishCandidateResult> {
      const input = inputSchema.parse(raw);
      const restaurant = input.restaurantId ? store.need('restaurants', owner, input.restaurantId) : null;
      const name = restaurant?.name as string | undefined ?? input.name, address = restaurant?.address as string | undefined ?? input.address;
      const groups = getDishReferences(name);
      const sources: DishCandidateResult['sources'] = [{ channel: 'wechat', status: groups.length ? 'ready' : 'empty', message: groups.length ? '已核实的品牌文章参考，不代表当前分店菜单' : '没有已维护的品牌文章参考', count: groups.reduce((n, g) => n + g.names.length, 0), origin: groups[0]?.origin }];
      const target = JSON.stringify([canonicalShop(name), normalizeDishName(address)]);
      const binding = restaurant ? db.prepare('SELECT url,source_name,source_address,target FROM dish_source_bindings WHERE owner_id=? AND restaurant_id=?').get(owner, restaurant.id) as { url: string; source_name: string; source_address: string; target: string } | undefined : undefined;
      const known = groups.length && /[（(]岗厦店[）)]/.test(canonicalShop(name)) ? GANGXIA_SOURCE : '';
      const linked = typeof restaurant?.link === 'string' && restaurant.link.startsWith('https://you.ctrip.com/food/') ? restaurant.link : '';
      const rawUrl = input.sourceUrl || binding?.url || linked || known;
      const result: DishCandidateResult = { name, restaurantId: input.restaurantId, candidates: [], sources, sourceUrl: '' };
      let row: CacheRow | undefined, url = '';
      if (rawUrl) {
        url = ctripSourceUrl(rawUrl); result.sourceUrl = url;
        try { row = input.load ? await load(url, owner) : cache(url); } catch (error) { sources.push({ channel: 'ctrip', status: 'failed', count: 0, message: error instanceof Error ? error.message : '公开菜品获取失败' }); }
      }
      if (row) {
        const group = row.data && clock().getTime() - row.fetched_at <= 7 * SAME_DAY ? JSON.parse(row.data) as DishReference : null;
        if (group) {
          const place: SourcePlace = { name: group.brand, address: group.origin.address!, url };
          const confirmed = input.confirm?.url === url && input.confirm.name === place.name && input.confirm.address === place.address;
          const bound = binding?.url === url && binding.source_name === place.name && binding.source_address === place.address && binding.target === target;
          if (confirmed || bound || exactPlace(name, address, group)) {
            groups.push(group);
            if (restaurant && (input.load || input.bind)) db.prepare('INSERT OR REPLACE INTO dish_source_bindings VALUES (?,?,?,?,?,?)').run(owner, restaurant.id, url, place.name, place.address, target);
            const stale = !!row.error || clock().getTime() - row.fetched_at >= SAME_DAY;
            sources.push({ channel: 'ctrip', status: stale ? 'stale' : group.names.length ? 'ready' : 'empty', count: group.names.length, origin: group.origin, message: stale ? `使用过期缓存，${row.error || '可重新获取'}；当日供应未核实` : '分店特色菜参考，非完整菜单；缓存24小时' });
          } else {
            result.pending = place;
            sources.push({ channel: 'ctrip', status: 'pending', count: group.names.length, message: '请核对来源店名和地址，确认后才加入候选', origin: group.origin });
          }
        } else sources.push({ channel: 'ctrip', status: 'failed', count: 0, message: row.error || '缓存已过期，请重新获取' });
      } else if (!sources.some(s => s.channel === 'ctrip')) sources.push({ channel: 'ctrip', status: 'idle', count: 0, message: url ? '已找到公开页线索，点击获取后核对分店' : '可添加这家店的携程公开餐厅详情链接' });
      result.candidates = aggregateDishCandidates(groups);
      return result;
    }
  };
}

export function dishCandidatesRouter(db: FoodDB, options: CandidateOptions = {}) {
  const router = Router(), service = createDishCandidates(db, options);
  router.get('/dish-candidates', async (req, res) => { res.json({ data: await service.query({ restaurantId: req.query.restaurantId ?? '', name: req.query.name ?? '', address: req.query.address ?? '', sourceUrl: req.query.sourceUrl ?? '' }, req.identity!.id) }); });
  router.post('/dish-candidates', async (req, res) => { res.json({ data: await service.query(req.body, req.identity!.id) }); });
  return router;
}
