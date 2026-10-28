import { Router, type Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { expiryFrom, type Period } from '../shared/period.js';
import type { FoodDB } from './database.js';
import { fail } from './errors.js';
import { createStore, type Rec } from './library.js';
import { photoDir } from './media.js';

export { expiryFrom };

const id = z.string().min(1).max(100);
export const periodSchema = z.object({ unit: z.enum(['day', 'month', 'forever']), count: z.number().int().min(1).max(3650).default(1) })
  .refine(p => p.unit !== 'month' || p.count <= 120, '按月最多 120 个月');
const selectionSchema = z.object({
  title: z.string().trim().min(1, '请填写分享标题').max(80),
  restaurants: z.array(id).min(1, '至少选择一家店').max(30),
  dishes: z.array(id).max(500).optional(),
  opinions: z.array(id).max(2000).optional(),
  photos: z.array(id).max(200).optional(),
  showPeople: z.boolean().default(false)
});
type Selection = z.infer<typeof selectionSchema>;
type ShareRow = { id: string; owner_id: string; token: string; title: string; created_at: string; expires_at: string | null; revoked: number; selection: string; snapshot: string };

export type PublicOpinion = { person: string; feeling: string | null; again: boolean | null; note: string };
export type Snapshot = {
  title: string;
  photos: string[];
  restaurants: { name: string; address: string; link: string; tags: string[]; photos: string[]; opinions: PublicOpinion[]; dishes: { name: string; variant: string; tags: string[]; photos: string[]; opinions: PublicOpinion[] }[] }[];
};

const statusOf = (r: Pick<ShareRow, 'revoked' | 'expires_at'>) =>
  r.revoked ? 'revoked' : r.expires_at && Date.parse(r.expires_at) <= Date.now() ? 'expired' : 'active';
const recommended = (o: Rec) => o.feeling === 'like' || o.again === true;

function buildSnapshot(db: FoodDB, owner: string, sel: Selection): Snapshot {
  const s = createStore(db);
  const people = new Map(s.all('people', owner).map(p => [p.id, p.name as string]));
  const allDishes = s.all('dishes', owner), allOpinions = s.all('opinions', owner);
  const rIds = new Set(sel.restaurants);
  for (const d of sel.dishes ?? []) if (!rIds.has(s.need('dishes', owner, d).restaurantId)) fail(400, 'SHARE_SCOPE', '所选菜品不属于分享的店铺');
  for (const o of sel.opinions ?? []) if (!rIds.has(s.need('opinions', owner, o).restaurantId)) fail(400, 'SHARE_SCOPE', '所选点评不属于分享的店铺');
  for (const p of sel.photos ?? []) s.photo(owner, p);
  const allowPhoto = (p: string) => !sel.photos || sel.photos.includes(p);
  const photos = new Set<string>();
  const pub = (o: Rec): PublicOpinion => ({ person: sel.showPeople ? people.get(o.personId) ?? '' : '', feeling: o.feeling ?? null, again: o.again ?? null, note: o.note ?? '' });
  const restaurants = sel.restaurants.map(rid => {
    const r = s.need('restaurants', owner, rid);
    const rOps = allOpinions.filter(o => o.restaurantId === rid);
    const rDishes = allDishes.filter(d => d.restaurantId === rid);
    const dishes = sel.dishes ? rDishes.filter(d => sel.dishes!.includes(d.id)) : rDishes.filter(d => !d.archived && rOps.some(o => o.dishId === d.id && recommended(o)));
    const ops = sel.opinions ? rOps.filter(o => sel.opinions!.includes(o.id)) : rOps.filter(o => recommended(o) && (!o.dishId || dishes.some(d => d.id === o.dishId)));
    const rPhotos = ((r.photos ?? []) as string[]).filter(allowPhoto);
    rPhotos.forEach(p => photos.add(p));
    return {
      name: r.name as string, address: r.address ?? '', link: r.link ?? '', tags: r.tags ?? [], photos: rPhotos,
      opinions: ops.filter(o => !o.dishId).map(pub),
      dishes: dishes.map(d => {
        const dPhotos = ((d.photos ?? []) as string[]).filter(allowPhoto);
        dPhotos.forEach(p => photos.add(p));
        return { name: d.name as string, variant: d.variant ?? '', tags: d.tags ?? [], photos: dPhotos, opinions: ops.filter(o => o.dishId === d.id).map(pub) };
      })
    };
  });
  return { title: sel.title, restaurants, photos: [...photos] };
}

const view = (r: ShareRow) => ({
  id: r.id, token: r.token, title: r.title, createdAt: r.created_at, expiresAt: r.expires_at,
  revoked: !!r.revoked, status: statusOf(r), selection: JSON.parse(r.selection) as Selection,
  restaurantCount: (JSON.parse(r.snapshot) as Snapshot).restaurants.length
});

export function shareRouter(db: FoodDB) {
  const router = Router();
  const row = (owner: string, shareId: string) =>
    (db.prepare('SELECT * FROM shares WHERE owner_id=? AND id=?').get(owner, shareId) as ShareRow | undefined) ?? fail(404, 'NOT_FOUND', '分享不存在');

  router.get('/shares', (req, res) => {
    const rows = db.prepare('SELECT * FROM shares WHERE owner_id=? ORDER BY created_at DESC').all(req.identity!.id) as ShareRow[];
    res.json({ data: rows.map(view) });
  });

  router.post('/shares/preview', (req, res) => {
    const sel = selectionSchema.parse(req.body);
    const { photos: _photos, ...snapshot } = buildSnapshot(db, req.identity!.id, sel);
    res.json({ data: snapshot });
  });

  router.post('/shares', (req, res) => {
    const owner = req.identity!.id;
    const input = selectionSchema.extend({ period: periodSchema }).parse(req.body);
    const { period, ...sel } = input;
    const snapshot = buildSnapshot(db, owner, sel);
    const shareId = randomUUID(), token = randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO shares (id,owner_id,token,title,created_at,expires_at,revoked,selection,snapshot) VALUES (?,?,?,?,?,?,0,?,?)')
      .run(shareId, owner, token, sel.title, new Date().toISOString(), expiryFrom(period as Period), JSON.stringify(sel), JSON.stringify(snapshot));
    res.status(201).json({ data: view(row(owner, shareId)) });
  });

  router.put('/shares/:id', (req, res) => {
    const owner = req.identity!.id;
    const current = row(owner, req.params.id);
    if (current.revoked) fail(409, 'REVOKED', '分享已撤销，请重新创建');
    const sel = selectionSchema.parse({ ...JSON.parse(current.selection), ...(req.body ?? {}) });
    const snapshot = buildSnapshot(db, owner, sel);
    db.prepare('UPDATE shares SET title=?, selection=?, snapshot=? WHERE id=? AND owner_id=?').run(sel.title, JSON.stringify(sel), JSON.stringify(snapshot), current.id, owner);
    res.json({ data: view(row(owner, current.id)) });
  });

  router.post('/shares/:id/renew', (req, res) => {
    const owner = req.identity!.id;
    const current = row(owner, req.params.id);
    if (current.revoked) fail(409, 'REVOKED', '已撤销的分享不能续期，请重新创建');
    const period = periodSchema.parse(req.body?.period);
    db.prepare('UPDATE shares SET expires_at=? WHERE id=? AND owner_id=?').run(expiryFrom(period as Period), current.id, owner);
    res.json({ data: view(row(owner, current.id)) });
  });

  router.delete('/shares/:id', (req, res) => {
    const owner = req.identity!.id;
    const current = row(owner, req.params.id);
    db.prepare('UPDATE shares SET revoked=1 WHERE id=? AND owner_id=?').run(current.id, owner);
    res.json({ data: { ok: true } });
  });

  return router;
}

export function publicShareRouter(db: FoodDB, dataDir: string) {
  const router = Router();
  const dir = photoDir(dataDir);
  const guard = (res: Response) => res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
  const active = (token: string) => {
    const r = db.prepare('SELECT * FROM shares WHERE token=?').get(token) as ShareRow | undefined;
    if (!r) fail(404, 'NOT_FOUND', '分享不存在');
    const status = statusOf(r);
    if (status === 'revoked') fail(410, 'REVOKED', '这个分享已被撤销');
    if (status === 'expired') fail(410, 'EXPIRED', '这个分享已过期');
    return r;
  };

  router.get('/shares/:token', (req, res) => {
    guard(res);
    const r = active(req.params.token);
    const { photos: _photos, ...snapshot } = JSON.parse(r.snapshot) as Snapshot;
    res.json({ data: { ...snapshot, expiresAt: r.expires_at } });
  });

  router.get('/shares/:token/photos/:photo', (req, res) => {
    guard(res);
    const r = active(req.params.token);
    if (!(JSON.parse(r.snapshot) as Snapshot).photos.includes(req.params.photo)) fail(404, 'NOT_FOUND', '照片不存在');
    const a = db.prepare('SELECT filename FROM attachments WHERE owner_id=? AND id=?').get(r.owner_id, req.params.photo) as { filename: string } | undefined;
    if (!a) fail(404, 'NOT_FOUND', '照片不存在');
    res.sendFile(join(dir, a.filename), { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'image/webp' } });
  });

  return router;
}
