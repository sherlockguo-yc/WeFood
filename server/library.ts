import { Router, type Request } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { schemas, type Resource } from '../shared/contracts.js';
import { normalizeDishName } from '../shared/dishReferences.js';
import type { FoodDB } from './database.js';
import { fail } from './errors.js';

type Row = { id: string; version: number; created_at: string; updated_at: string; data: string };
// 记录字段由 Zod schema 在写入时校验，读取时以宽松结构返回给业务逻辑。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rec = { id: string; version: number; createdAt: string; updatedAt: string } & Record<string, any>;

export const resources = Object.keys(schemas) as Resource[];
const labels: Record<Resource, string> = { people: '人物', restaurants: '店铺', dishes: '菜品', meals: '就餐记录', opinions: '点评', tags: '标签' };
const COLS = 'id,version,created_at,updated_at,data';

export function createStore(db: FoodDB) {
  const toRec = (r: Row): Rec => ({ ...JSON.parse(r.data), id: r.id, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at });
  const all = (t: Resource, owner: string): Rec[] =>
    (db.prepare(`SELECT ${COLS} FROM ${t} WHERE owner_id=? ORDER BY updated_at DESC`).all(owner) as Row[]).map(toRec);
  const get = (t: Resource, owner: string, id: string): Rec | undefined => {
    const r = db.prepare(`SELECT ${COLS} FROM ${t} WHERE owner_id=? AND id=?`).get(owner, id) as Row | undefined;
    return r ? toRec(r) : undefined;
  };
  const need = (t: Resource, owner: string, id: string): Rec => get(t, owner, id) ?? fail(404, 'NOT_FOUND', `${labels[t]}不存在或无权访问`);
  const insert = (t: Resource, owner: string, data: object): Rec => {
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare(`INSERT INTO ${t} (id,owner_id,version,created_at,updated_at,data) VALUES (?,?,?,?,?,?)`).run(id, owner, 1, now, now, JSON.stringify(data));
    return need(t, owner, id);
  };
  const update = (t: Resource, owner: string, id: string, version: number, data: object): Rec => {
    const r = db.prepare(`UPDATE ${t} SET data=?, version=version+1, updated_at=? WHERE owner_id=? AND id=? AND version=?`)
      .run(JSON.stringify(data), new Date().toISOString(), owner, id, version);
    if (!r.changes) { need(t, owner, id); fail(409, 'VERSION_CONFLICT', '这条记录已在其他设备修改，请查看最新内容后再保存'); }
    return need(t, owner, id);
  };
  const remove = (t: Resource, owner: string, id: string) => { db.prepare(`DELETE FROM ${t} WHERE owner_id=? AND id=?`).run(owner, id); };
  const photo = (owner: string, id: string) => {
    if (!db.prepare('SELECT id FROM attachments WHERE owner_id=? AND id=?').get(owner, id)) fail(404, 'NOT_FOUND', '照片不存在或无权访问');
  };
  return { db, all, get, need, insert, update, remove, photo };
}
export type Store = ReturnType<typeof createStore>;

export const plain = (r: Rec) => {
  const { id: _id, version: _version, createdAt: _created, updatedAt: _updated, opinions: _opinions, ...rest } = r;
  return rest;
};
export const str = (v: unknown) => (typeof v === 'string' ? v : '');
export const list = (v: unknown) => str(v).split(',').map(s => s.trim()).filter(Boolean);
const digest = (v: string) => createHash('sha256').update(v).digest('hex');

export function libraryRouter(db: FoodDB) {
  const s = createStore(db);
  const router = Router();
  const me = (req: Request) => req.identity!.id;

  const withOpinions = (owner: string, meals: Rec[]) => {
    const byMeal = new Map<string, Rec[]>();
    for (const o of s.all('opinions', owner)) if (o.mealId) byMeal.set(o.mealId, [...(byMeal.get(o.mealId) ?? []), o]);
    return meals.map(m => ({ ...m, opinions: byMeal.get(m.id) ?? [] }));
  };
  const byDate = (a: Rec, b: Rec) => Date.parse(b.date) - Date.parse(a.date);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function check(t: Resource, owner: string, d: any, allowLegacyAddress = false) {
    for (const p of d.photos ?? []) s.photo(owner, p);
    if (t === 'dishes') {
      s.need('restaurants', owner, d.restaurantId);
      for (const origin of [d.origin, ...(d.origin?.evidence ?? [])]) if (origin?.photoId) s.photo(owner, origin.photoId);
    }
    if (t === 'meals') {
      const restaurant = s.need('restaurants', owner, d.restaurantId);
      if (d.mode === 'dine-in' && !allowLegacyAddress && !restaurant.address?.trim()) fail(400, 'ADDRESS_REQUIRED', '堂食请先补充店铺地址，再保存这次记录');
      for (const p of d.people) s.need('people', owner, p);
      for (const id of d.dishes) if (s.need('dishes', owner, id).restaurantId !== d.restaurantId) fail(400, 'DISH_RESTAURANT', '所选菜品不属于这家店');
      for (const o of d.opinions) {
        s.need('people', owner, o.personId);
        if (!d.people.includes(o.personId)) fail(400, 'OPINION_PERSON', '点评的人需要在本次同行者中');
        if (o.dishId && !d.dishes.includes(o.dishId)) fail(400, 'OPINION_DISH', '只能评价本次实际吃过的菜');
      }
    }
    if (t === 'opinions') {
      s.need('restaurants', owner, d.restaurantId);
      s.need('people', owner, d.personId);
      if (d.dishId && s.need('dishes', owner, d.dishId).restaurantId !== d.restaurantId) fail(400, 'DISH_RESTAURANT', '菜品不属于这家店');
      if (d.mealId && s.need('meals', owner, d.mealId).restaurantId !== d.restaurantId) fail(400, 'MEAL_RESTAURANT', '就餐记录不属于这家店');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function writeMealOpinions(owner: string, mealId: string, d: any) {
    for (const o of d.opinions) s.insert('opinions', owner, { ...o, restaurantId: d.restaurantId, mealId });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function create(t: Resource, owner: string, d: any): Rec {
    check(t, owner, d);
    if (t === 'restaurants' && d.location?.source === 'tencent') {
      const existing = s.all('restaurants', owner).find(r => r.location?.source === 'tencent' && r.location.providerId === d.location.providerId);
      if (existing) return existing;
    }
    if (t === 'dishes') {
      const existing = s.all('dishes', owner).find(x => !x.archived && x.restaurantId === d.restaurantId && normalizeDishName(x.name) === normalizeDishName(d.name) && normalizeDishName(x.variant ?? '') === normalizeDishName(d.variant ?? ''));
      if (existing) return existing;
    }
    if (t === 'tags' && s.all('tags', owner).some(x => x.name === d.name)) fail(409, 'DUPLICATE', '这个标签已经存在');
    if (t !== 'meals') return s.insert(t, owner, d);
    const { opinions: _ops, ...meal } = d;
    const rec = s.insert('meals', owner, meal);
    writeMealOpinions(owner, rec.id, d);
    return withOpinions(owner, [rec])[0];
  }

  router.get('/restaurants/:id/overview', (req, res) => {
    const owner = me(req);
    const restaurant = s.need('restaurants', owner, req.params.id);
    res.json({
      data: {
        restaurant,
        dishes: s.all('dishes', owner).filter(d => d.restaurantId === restaurant.id),
        meals: withOpinions(owner, s.all('meals', owner).filter(m => m.restaurantId === restaurant.id)).sort(byDate),
        opinions: s.all('opinions', owner).filter(o => o.restaurantId === restaurant.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        people: s.all('people', owner)
      }
    });
  });

  router.post('/tags/merge', (req, res) => {
    const owner = me(req);
    const { from, to } = z.object({ from: z.string().trim().min(1).max(40), to: z.string().trim().min(1).max(40) }).parse(req.body);
    if (from === to) fail(400, 'VALIDATION', '请选择两个不同的标签');
    let changed = 0;
    db.transaction(() => {
      for (const t of ['restaurants', 'dishes'] as const) for (const r of s.all(t, owner)) {
        if (!(r.tags ?? []).includes(from)) continue;
        const tags = [...new Set((r.tags as string[]).map(x => (x === from ? to : x)))];
        s.update(t, owner, r.id, r.version, { ...plain(r), tags }); changed++;
      }
      for (const tag of s.all('tags', owner)) if (tag.name === from) s.remove('tags', owner, tag.id);
      if (!s.all('tags', owner).some(x => x.name === to)) s.insert('tags', owner, { name: to, category: '自定义' });
    })();
    res.json({ data: { changed } });
  });

  router.get('/:resource', (req, res, next) => {
    const t = req.params.resource as Resource;
    if (!resources.includes(t)) { next(); return; }
    const owner = me(req);
    const q = str(req.query.q).toLowerCase(), tag = str(req.query.tag), restaurantId = str(req.query.restaurantId);
    const includeArchived = req.query.archived === 'include';
    let rows = s.all(t, owner);
    if (!includeArchived) rows = rows.filter(r => !r.archived);
    if (restaurantId) rows = rows.filter(r => r.restaurantId === restaurantId);
    if (tag) rows = rows.filter(r => (r.tags ?? []).includes(tag));
    if (q) rows = rows.filter(r => [r.name, r.note, r.address, r.variant, ...(r.tags ?? [])].some(v => typeof v === 'string' && v.toLowerCase().includes(q)));
    if (t === 'meals') rows = withOpinions(owner, rows).sort(byDate);
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000), offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json({ data: rows.slice(offset, offset + limit) });
  });

  router.get('/:resource/:id', (req, res, next) => {
    const t = req.params.resource as Resource;
    if (!resources.includes(t)) { next(); return; }
    const rec = s.need(t, me(req), req.params.id);
    res.json({ data: t === 'meals' ? withOpinions(me(req), [rec])[0] : rec });
  });

  router.post('/:resource', (req, res, next) => {
    const t = req.params.resource as Resource;
    if (!resources.includes(t)) { next(); return; }
    const owner = me(req);
    const body = schemas[t].parse(req.body);
    const key = req.get('Idempotency-Key');
    if (!key) { res.status(201).json({ data: db.transaction(() => create(t, owner, body))() }); return; }
    if (key.length < 8 || key.length > 100) fail(400, 'VALIDATION', '保存标识无效，请刷新页面后重试');
    const hash = digest(`${t}:${JSON.stringify(body)}`);
    const result = db.transaction(() => {
      const prev = db.prepare('SELECT digest,result FROM idempotency_keys WHERE owner_id=? AND key=?').get(owner, key) as { digest: string; result: string } | undefined;
      if (prev) {
        if (prev.digest !== hash) fail(409, 'IDEMPOTENCY', '上一次保存可能已经成功，内容随后又有变化。请先到记忆库确认，避免重复记录');
        const { resource, id } = JSON.parse(prev.result) as { resource: Resource; id: string };
        const rec = s.need(resource, owner, id);
        return { replay: true, rec: resource === 'meals' ? withOpinions(owner, [rec])[0] : rec };
      }
      const rec = create(t, owner, body);
      db.prepare('INSERT INTO idempotency_keys (owner_id,key,digest,result) VALUES (?,?,?,?)').run(owner, key, hash, JSON.stringify({ resource: t, id: rec.id }));
      return { replay: false, rec };
    })();
    res.status(result.replay ? 200 : 201).json({ data: result.rec });
  });

  router.put('/:resource/:id', (req, res, next) => {
    const t = req.params.resource as Resource;
    if (!resources.includes(t)) { next(); return; }
    const owner = me(req);
    const existing = s.need(t, owner, req.params.id);
    const version = z.number({ error: '缺少记录版本，请刷新后再保存' }).int().positive().parse(req.body?.version);
    const { version: _v, ...patch } = (req.body ?? {}) as Record<string, unknown>;
    const base: Record<string, unknown> = plain(existing);
    if (t === 'meals') {
      base.opinions = (withOpinions(owner, [existing])[0].opinions as Rec[])
        .map(o => ({ personId: o.personId, dishId: o.dishId, feeling: o.feeling, again: o.again, note: o.note }));
    }
    const merged = schemas[t].parse({ ...base, ...patch });
    const rec = db.transaction(() => {
      check(t, owner, merged, t === 'meals' && existing.mode === 'dine-in' && existing.restaurantId === (merged as Record<string, unknown>).restaurantId);
      if (t === 'restaurants') {
        const location = (merged as Record<string, unknown>).location as { source: string; providerId?: string } | null;
        if (location?.source === 'tencent' && s.all('restaurants', owner).some(r => r.id !== existing.id && r.location?.source === 'tencent' && r.location.providerId === location.providerId)) fail(409, 'POI_EXISTS', '这家地图店铺已在记忆库中，请直接选择已有店铺，不要覆盖原店历史');
      }
      if (t !== 'meals') return s.update(t, owner, existing.id, version, merged);
      const { opinions: _ops, ...meal } = merged as Record<string, unknown>;
      const updated = s.update('meals', owner, existing.id, version, meal);
      db.prepare("DELETE FROM opinions WHERE owner_id=? AND json_extract(data,'$.mealId')=?").run(owner, existing.id);
      writeMealOpinions(owner, existing.id, merged);
      return withOpinions(owner, [updated])[0];
    })();
    res.json({ data: rec });
  });

  router.delete('/:resource/:id', (req, res, next) => {
    const t = req.params.resource as Resource;
    if (!resources.includes(t)) { next(); return; }
    const owner = me(req);
    const existing = s.need(t, owner, req.params.id);
    db.transaction(() => {
      if (t === 'meals') {
        db.prepare("DELETE FROM opinions WHERE owner_id=? AND json_extract(data,'$.mealId')=?").run(owner, existing.id);
        s.remove('meals', owner, existing.id);
      } else if (t === 'opinions' || t === 'tags') s.remove(t, owner, existing.id);
      else s.update(t, owner, existing.id, existing.version, { ...plain(existing), archived: true });
    })();
    res.json({ data: { ok: true, archived: !['meals', 'opinions', 'tags'].includes(t) } });
  });

  return router;
}
