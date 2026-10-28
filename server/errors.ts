import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function fail(status: number, code: string, message: string): never { throw new HttpError(status, code, message); }
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) { res.status(400).json({ error: { code: 'VALIDATION', message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；') } }); return; }
  if (error instanceof HttpError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
  if (error?.code === 'LIMIT_FILE_SIZE' || error?.code === 'LIMIT_FILE_COUNT') { res.status(413).json({ error: { code: 'UPLOAD_LIMIT', message: '最多上传 8 张图片，每张不超过 10MB' } }); return; }
  if (error?.code?.startsWith('SQLITE_CONSTRAINT')) { res.status(409).json({ error: { code: 'CONFLICT', message: '记录冲突，请检查重复名称或刷新后重试' } }); return; }
  if (error instanceof SyntaxError || error?.code?.startsWith('LIMIT_')) { res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '请求格式或上传字段不正确' } }); return; }
  console.error('WeFood request failed:', error?.name || 'Error');
  res.status(500).json({ error: { code: 'INTERNAL', message: '保存未完成，请稍后重试；输入内容请先保留' } });
};
