import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FoodDB } from './database.js';
import { fail } from './errors.js';

const MAX_FILES = 8;
const ORPHAN_RETENTION_MS = 7 * 86400_000;

export const photoDir = (dataDir: string) => {
  const dir = join(dataDir, 'photos');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
};

/** 收集所有仍被店铺、菜品、就餐或未撤销分享引用的照片。 */
export function referencedPhotos(db: FoodDB, owner?: string) {
  const ids = new Set<string>();
  for (const table of ['restaurants', 'dishes', 'meals']) {
    const rows = (owner
      ? db.prepare(`SELECT data FROM ${table} WHERE owner_id=?`).all(owner)
      : db.prepare(`SELECT data FROM ${table}`).all()) as { data: string }[];
    for (const r of rows) {
      const data = JSON.parse(r.data);
      for (const id of (data.photos ?? []) as string[]) ids.add(id);
      for (const origin of [data.origin, ...(data.origin?.evidence ?? [])]) if (origin?.photoId) ids.add(origin.photoId);
    }
  }
  const shares = (owner
    ? db.prepare('SELECT snapshot FROM shares WHERE owner_id=? AND revoked=0').all(owner)
    : db.prepare('SELECT snapshot FROM shares WHERE revoked=0').all()) as { snapshot: string }[];
  for (const s of shares) for (const id of (JSON.parse(s.snapshot).photos ?? []) as string[]) ids.add(id);
  return ids;
}

export function cleanupOrphanPhotos(db: FoodDB, dataDir: string, now = Date.now()) {
  const dir = photoDir(dataDir);
  const used = referencedPhotos(db);
  const old = db.prepare('SELECT id, filename, created_at FROM attachments').all() as { id: string; filename: string; created_at: string }[];
  let removed = 0;
  for (const a of old) {
    if (used.has(a.id) || now - Date.parse(a.created_at) < ORPHAN_RETENTION_MS) continue;
    db.prepare('DELETE FROM attachments WHERE id=?').run(a.id);
    rmSync(join(dir, a.filename), { force: true });
    removed++;
  }
  return removed;
}

export function mediaRouter(db: FoodDB, dataDir: string) {
  const dir = photoDir(dataDir);
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: MAX_FILES },
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype))
  });

  router.post('/photos', upload.array('photos', MAX_FILES), async (req, res) => {
    const owner = req.identity!.id;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) fail(400, 'NO_PHOTO', '请选择 JPG、PNG 或 WebP 图片');
    const saved: { id: string }[] = [];
    try {
      for (const f of files) {
        const id = randomUUID();
        await sharp(f.buffer, { limitInputPixels: 50_000_000, failOn: 'error' })
          .rotate()
          .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(join(dir, `${id}.webp`));
        db.prepare('INSERT INTO attachments (id,owner_id,created_at,filename) VALUES (?,?,?,?)').run(id, owner, new Date().toISOString(), `${id}.webp`);
        saved.push({ id });
      }
    } catch {
      for (const s of saved) {
        db.prepare('DELETE FROM attachments WHERE id=?').run(s.id);
        rmSync(join(dir, `${s.id}.webp`), { force: true });
      }
      fail(400, 'BAD_IMAGE', '无法识别其中的图片，请换用 JPG、PNG 或 WebP 照片');
    }
    res.status(201).json({ data: saved });
  });

  router.get('/photos/:id', (req, res) => {
    const row = db.prepare('SELECT filename FROM attachments WHERE owner_id=? AND id=?').get(req.identity!.id, req.params.id) as { filename: string } | undefined;
    if (!row) fail(404, 'NOT_FOUND', '照片不存在或无权访问');
    res.sendFile(join(dir, row.filename), { headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'image/webp' } });
  });

  router.delete('/photos/:id', (req, res) => {
    const owner = req.identity!.id;
    const row = db.prepare('SELECT filename FROM attachments WHERE owner_id=? AND id=?').get(owner, req.params.id) as { filename: string } | undefined;
    if (!row) fail(404, 'NOT_FOUND', '照片不存在或无权访问');
    if (referencedPhotos(db, owner).has(req.params.id)) fail(409, 'PHOTO_IN_USE', '照片仍在记录或分享中使用，请先从对应内容中移除');
    db.prepare('DELETE FROM attachments WHERE owner_id=? AND id=?').run(owner, req.params.id);
    rmSync(join(dir, row.filename), { force: true });
    res.json({ data: { ok: true } });
  });

  return router;
}
