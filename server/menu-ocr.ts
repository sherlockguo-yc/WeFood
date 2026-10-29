import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';
import type { FoodDB } from './database.js';
import { photoDir } from './media.js';
import { fail } from './errors.js';

export const menuLines = (text: string) => [...new Set(text.split(/\r?\n/).map(line => line.normalize('NFKC').replace(/\s+/g, '').replace(/(?:[¥￥]?\d+(?:\.\d{1,2})?(?:元|圆|\/份|\/例)?)$/, '').replace(/^[\d.、]+/, '').trim()).filter(n => n.length >= 2 && n.length <= 120 && !/电话|地址|营业时间|菜单|联系方式/.test(n)))].slice(0, 100);
export type OcrOptions = { recognize?: (buffer: Buffer) => Promise<{ text: string; confidence: number }>; timeoutMs?: number };
export async function recognizeMenu(buffer: Buffer, dataDir: string, timeoutMs = 60_000): Promise<{ text: string; confidence: number }> {
  const require = createRequire(import.meta.url), langDir = join(dataDir, 'ocr-languages');
  mkdirSync(langDir, { recursive: true, mode: 0o700 });
  for (const code of ['chi_sim', 'eng']) {
    const file = `${code}.traineddata.gz`, target = join(langDir, file);
    if (!existsSync(target)) copyFileSync(join(require(`@tesseract.js-data/${code}`).langPath, file), target);
  }
  let worker: Worker | undefined, expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; void worker?.terminate(); reject(new Error('菜单识别超时，请裁剪清晰区域后重试')); }, timeoutMs); });
  const work = (async () => {
    const created = await createWorker(['chi_sim', 'eng'], 1, { langPath: langDir, gzip: true, cacheMethod: 'none', errorHandler: () => {} });
    worker = created;
    if (expired) { await created.terminate(); throw new Error('菜单识别超时'); }
    const { data } = await created.recognize(buffer);
    return { text: data.text.slice(0, 20000), confidence: Number(data.confidence) || 0 };
  })();
  try { return await Promise.race([work, deadline]); }
  finally { clearTimeout(timer); if (!expired) await worker?.terminate(); }
}
export function menuOcrRouter(db: FoodDB, dataDir: string, options: OcrOptions = {}) {
  const router = Router(), upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  let active = false;
  router.post('/menu-ocr', (req, res, next) => { if (active) { res.status(429).json({ error: { code: 'OCR_BUSY', message: '菜单识别繁忙，请稍后重试' } }); return; } active = true; res.once('close', () => { if (!req.file) active = false; }); next(); }, upload.single('menu'), async (req, res) => {
    let file: string | undefined;
    try {
      if (!req.file) fail(400, 'NO_PHOTO', '请选择一张清晰菜单图片');
      const buffer = await sharp(req.file.buffer, { limitInputPixels: 30_000_000, failOn: 'error' }).rotate().resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true }).png().toBuffer().catch(() => fail(400, 'BAD_IMAGE', '菜单图片无法读取，请选择JPG、PNG或WebP'));
      const result = await (options.recognize ? options.recognize(buffer) : recognizeMenu(buffer, dataDir, options.timeoutMs));
      if (!result.text.trim()) fail(400, 'OCR_EMPTY', '没有识别到文字，请裁剪或更换清晰照片');
      const id = randomUUID(); file = join(photoDir(dataDir), `${id}.webp`);
      await sharp(buffer).webp({ lossless: true }).toFile(file);
      db.prepare('INSERT INTO attachments (id,owner_id,created_at,filename) VALUES (?,?,?,?)').run(id, req.identity!.id, new Date().toISOString(), `${id}.webp`);
      res.json({ data: { ...result, names: menuLines(result.text), photoId: id, checkedAt: new Date().toISOString().slice(0, 10) } });
    } catch (error) {
      if (file) rmSync(file, { force: true });
      if (error instanceof Error && error.name === 'HttpError') throw error;
      fail(400, 'OCR_FAILED', '菜单本地识别未完成，请换用清晰照片或稍后重试');
    } finally { active = false; }
  });
  router.use('/menu-ocr', (error: unknown, _req: unknown, _res: unknown, next: (error: unknown) => void) => { active = false; next(error); });
  return router;
}
