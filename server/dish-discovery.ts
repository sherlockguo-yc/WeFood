import { load } from 'cheerio';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import type { FoodDB } from './database.js';
import { normalizeDishName, type DishReference, type CandidateSource, type SourcePlace } from '../shared/dishReferences.js';

export const shopKey = (name: string) => normalizeDishName(name).replace(/號/g, '号').replace(/漁/g, '渔');
export function publicUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || isIP(u.hostname) || !u.hostname.includes('.') || /(?:^|\.)(localhost|local|internal|home|test|invalid)$/.test(u.hostname)) throw new Error('不允许访问非公开HTTPS地址');
  return u;
}
export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 6) return /^2[0-9a-f]{3}:/i.test(ip) && !/^2001:(?:db8|0):/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return isIP(ip) === 4 && a > 0 && a < 224 && ![10, 127].includes(a) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && [0, 168].includes(b)) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && [18, 19, 51].includes(b)) && !(a === 203 && b === 0);
}
export async function readPublicPage(raw: string, fetchImpl?: typeof fetch): Promise<string> {
  const u = publicUrl(raw), limit = 4 * 1024 * 1024;
  if (fetchImpl) {
    const r = await fetchImpl(u.href, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!r.ok || !r.headers.get('content-type')?.includes('text/html')) throw new Error('公开页面不可读');
    const reader = r.body?.getReader(); if (!reader) throw new Error('公开页面无正文');
    const parts: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('公开页面过大'); } parts.push(value); }
    return Buffer.concat(parts).toString('utf8');
  }
  const addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('不允许访问私有网络地址');
  return new Promise((resolve, reject) => {
    const req = request(u, { headers: { Accept: 'text/html', 'Accept-Encoding': 'identity' }, lookup: (_host, opts, cb) => { if (opts.all) cb(null, addresses); else cb(null, addresses[0].address, addresses[0].family); } }, res => {
      if (res.statusCode !== 200 || !String(res.headers['content-type']).includes('text/html')) { res.resume(); reject(new Error('公开页面不可读或要求跳转/登录')); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > limit) req.destroy(new Error('公开页面过大')); else chunks.push(chunk); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('公开页面读取超时')), 15000);
    req.on('close', () => clearTimeout(timer)); req.on('error', () => reject(new Error('公开页面连接失败'))); req.end();
  });
}
export type SearchHit = { title: string; url: string };
export function parseSearchPage(html: string): SearchHit[] {
  const $ = load(html), hits = new Map<string, SearchHit>();
  $('h3 a[data-mdurl], .result__a').each((_i, node) => {
    const a = $(node); let raw = a.attr('data-mdurl') ?? a.attr('href') ?? '';
    try {
      const wrapped = new URL(raw, 'https://duckduckgo.com'); raw = wrapped.searchParams.get('uddg') ?? raw;
      const u = publicUrl(raw); const title = a.text().trim().slice(0, 200);
      if (title) hits.set(u.href, { title, url: u.href });
    } catch { /* 不采纳搜索跳转、登录或私网链接。 */ }
  });
  return [...hits.values()].slice(0, 10);
}
export function normalizeCtripHit(url: string): string | null {
  try {
    const u = publicUrl(url);
    if (u.hostname === 'you.ctrip.com') {
      const m = u.pathname.match(/^\/food\/([a-zA-Z0-9]+)\/(\d+)(?:-dianping[^/]*)?\.html$/);
      if (m) return `https://you.ctrip.com/food/${m[1]}/${m[2]}.html`;
    }
    if (u.hostname === 'gs.ctrip.com') {
      const m = u.pathname.match(/^\/html5\/you\/foods\/fooddetail\/(\d+)\/(\d+)\.html$/);
      if (m) return `https://you.ctrip.com/food/${m[1]}/${m[2]}.html`;
    }
  } catch { return null; }
  return null;
}
export function parseMenuPage(html: string, url: string, name: string, checkedAt: string): DishReference | null {
  const $ = load(html), rootName = name.split(/[（(]/)[0].trim();
  const title = $('title').text().trim();
  if (!shopKey(title).includes(shopKey(rootName))) return null;
  const names = new Set<string>();
  const walk = (data: unknown): void => {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data)) { data.forEach(walk); return; }
    const obj = data as Record<string, unknown>;
    if (obj['@type'] === 'MenuItem' && typeof obj.name === 'string' && obj.name.length <= 120) names.add(obj.name.trim());
    Object.values(obj).forEach(walk);
  };
  $('script[type="application/ld+json"]').each((_i, e) => { try { walk(JSON.parse($(e).text())); } catch { /* 无效结构不提取。 */ } });
  $('h1,h2,h3,h4,strong').each((_i, e) => {
    if (!/^(?:本店)?(?:特色菜品?|特色美食|菜品清单|菜单|推荐菜品?)[:：]?$/.test($(e).text().trim())) return;
    const list = $(e).parent().is('h1,h2,h3,h4') ? $(e).parent().next('ul,ol') : $(e).next('ul,ol');
    list.find('li').slice(0, 100).each((_j, li) => { const n = $(li).text().trim(); if (n && n.length <= 120 && !/电话|地址|营业|登录/.test(n)) names.add(n); });
  });
  if (!names.size) return null;
  return { id: url, brand: name, names: [...names].slice(0, 100), origin: { publisher: new URL(url).hostname, title: title.slice(0, 200) || '公开菜品页面', url, publishedAt: null, checkedAt, scope: 'brand', coverage: 'partial', restaurantName: name } };
}
const emptyWords = new Set(['特色菜', '特色美食', '美食', '餐饮', '招牌菜', '推荐菜', '海鲜盛宴']);
export function parseAmap(raw: unknown, checkedAt: string): DishReference[] {
  const d = raw as { status?: string; infocode?: string; pois?: Record<string, unknown>[] };
  if (d.status !== '1') throw new Error(`高德查询失败（${d.infocode ?? '未知状态'}），请检查Web服务Key和额度`);
  return (d.pois ?? []).flatMap(p => {
    if (typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.address !== 'string' || typeof p.tag !== 'string') return [];
    const names = p.tag.split(/[,，;；]/).map(n => n.trim()).filter(n => n && n.length <= 120 && !emptyWords.has(n));
    if (!names.length) return [];
    const url = `https://www.amap.com/place/${encodeURIComponent(p.id)}`;
    return [{ id: url, brand: p.name, names, origin: { publisher: '高德地图', title: `${p.name} · 特色菜参考`, url, publishedAt: null, checkedAt, scope: 'branch' as const, coverage: 'partial' as const, restaurantName: p.name, address: p.address } }];
  });
}
export type DiscoveryOptions = { fetchImpl?: typeof fetch; amapKey?: string; now?: () => Date };
export function createDiscovery(db: FoodDB, options: DiscoveryOptions, consume: (owner: string) => void, getCtrip: (url: string, owner: string) => Promise<DishReference | null>) {
  db.exec('CREATE TABLE IF NOT EXISTS dish_discovery_cache (target TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS dish_discovery_bindings (owner TEXT NOT NULL,restaurant TEXT NOT NULL,target TEXT NOT NULL,url TEXT NOT NULL,PRIMARY KEY(owner,restaurant,target,url))');
  type Snapshot = { groups: DishReference[]; sources: CandidateSource[]; fetchedAt: number };
  const pending = new Map<string, Promise<Snapshot>>();
  return async (name: string, address: string, owner: string, restaurant: string, run: boolean, confirm?: SourcePlace, confirmations: SourcePlace[] = [], location?: { lat: number; lng: number }) => {
    const target = JSON.stringify([shopKey(name), normalizeDishName(address), ...(location ? [location.lat, location.lng] : [])]), now = options.now?.() ?? new Date();
    const row = db.prepare('SELECT data,expires FROM dish_discovery_cache WHERE target=?').get(target) as { data: string; expires: number } | undefined;
    const saved: Snapshot = row ? JSON.parse(row.data) : { groups: [], sources: [], fetchedAt: now.getTime() };
    if (!Number.isFinite(saved.fetchedAt)) saved.fetchedAt = (row?.expires ?? now.getTime()) - 86400_000;
    if (now.getTime() - saved.fetchedAt > 7 * 86400_000) saved.groups = [];
    let result = { ...saved };
    if (row && row.expires < now.getTime()) result.sources = saved.sources.map(s => ({ ...s, status: 'stale' as const, message: `缓存已过期，${saved.groups.length ? '暂用旧资料，可重新搜索' : '旧菜品已停止展示，请重新搜索'}` }));
    if (run && (!row || row.expires < now.getTime())) {
      let work = pending.get(target);
      if (!work) {
        if (pending.size >= 2) throw new Error('自动搜索繁忙，请稍后重试');
        work = (async () => {
          const groups: DishReference[] = [], sources: CandidateSource[] = [], day = now.toISOString().slice(0, 10);
          const searchWork = (async () => {
          try {
            let hits: SearchHit[] = [];
            for (const provider of ['https://www.so.com/s?q=', 'https://html.duckduckgo.com/html/?q=']) {
              consume(owner);
              try { hits = parseSearchPage(await readPublicPage(provider + encodeURIComponent(`${name} ${address.slice(0, 12)} 菜单 携程`), options.fetchImpl)); if (hits.length) break; } catch { /* 独立公开搜索渠道失败可尝试另一渠道。 */ }
            }
            const urls = [...new Set(hits.map(h => normalizeCtripHit(h.url)).filter((u): u is string => !!u))].slice(0, 3);
            for (const url of urls) { try { const group = await getCtrip(url, owner); if (group) groups.push(group); } catch { /* 单个页面失败不阻断其他候选。 */ } }
            const others = hits.filter(h => !normalizeCtripHit(h.url) && !/ctrip\.com/.test(h.url)).slice(0, 2);
            for (const hit of others) { try { consume(owner); const group = parseMenuPage(await readPublicPage(hit.url, options.fetchImpl), hit.url, name, day); if (group) groups.push(group); } catch { /* 受限公开页面不导入。 */ } }
            sources.push({ channel: 'search', status: hits.length ? 'ready' : 'empty', message: hits.length ? `自动找到${urls.length}条携程线索；其他公开页只读取明确菜品列表，歧义来源需确认` : '公开搜索未返回有效线索或暂时受限，可以稍后重试或识别菜单照片', count: hits.length });
          } catch { sources.push({ channel: 'search', status: 'failed', message: '自动搜索失败，其他来源仍保留', count: 0 }); }
          })();
          const amapWork = (async () => {
          try {
            if (!options.amapKey) throw new Error('高德特色菜未配置Web服务Key');
            consume(owner);
            const q = new URLSearchParams({ key: options.amapKey, keywords: name, types: '050000', extensions: 'all', offset: '10', page: '1' });
            const city = address.match(/^(.{2,8}?市)/)?.[1];
            if (city) { q.set('city', city); q.set('citylimit', 'true'); }
            if (location) { q.set('location', `${location.lng.toFixed(6)},${location.lat.toFixed(6)}`); q.set('radius', '1000'); }
            const r = await (options.fetchImpl ?? fetch)(`https://restapi.amap.com/v3/place/${location ? 'around' : 'text'}?${q}`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
            if (!r.ok) throw new Error('高德查询连接失败');
            const parsed = parseAmap(await r.json(), day); groups.push(...parsed);
            sources.push({ channel: 'amap', status: parsed.length ? 'ready' : 'empty', message: '地图特色菜非完整菜单，核对分店后加入', count: parsed.reduce((n, g) => n + g.names.length, 0) });
          } catch (e) { sources.push({ channel: 'amap', status: 'failed', message: e instanceof Error && !['TypeError', 'AbortError'].includes(e.name) ? e.message : '高德特色菜查询暂不可用', count: 0 }); }
          })();
          await Promise.all([searchWork, amapWork]);
          sources.sort((a, b) => a.channel.localeCompare(b.channel));
          const failed = !groups.length;
          const fallback = failed && sources.some(s => s.status === 'failed') && saved.groups.length > 0;
          const data: Snapshot = { groups: fallback ? saved.groups : groups, fetchedAt: fallback ? saved.fetchedAt : now.getTime(), sources: fallback ? sources.map(s => ({ ...s, status: 'stale', message: `${s.message}；暂用未超过7天的旧资料` })) : sources };
          db.prepare('INSERT OR REPLACE INTO dish_discovery_cache VALUES (?,?,?)').run(target, JSON.stringify(data), now.getTime() + (failed ? 60000 : 86400_000));
          return data;
        })();
        pending.set(target, work);
      }
      try { result = await work; } finally { pending.delete(target); }
    }
    const accepted: DishReference[] = [], choices: SourcePlace[] = [];
    for (const group of result.groups) {
      const place = { name: group.brand, address: group.origin.address ?? '', url: group.origin.url! };
      const bound = restaurant && db.prepare('SELECT 1 FROM dish_discovery_bindings WHERE owner=? AND restaurant=? AND target=? AND url=?').get(owner, restaurant, target, place.url);
      const exact = shopKey(name) === shopKey(place.name) && !!address && normalizeDishName(address) === normalizeDishName(place.address);
      const confirmed = [...confirmations, ...(confirm ? [confirm] : [])].some(p => p.url === place.url && p.name === place.name && p.address === place.address);
      if (bound || exact || confirmed) {
        accepted.push(group);
        if (restaurant && (run || confirmed)) db.prepare('INSERT OR IGNORE INTO dish_discovery_bindings VALUES (?,?,?,?)').run(owner, restaurant, target, place.url);
      } else choices.push(place);
    }
    return { groups: accepted, choices, sources: result.sources };
  };
}
