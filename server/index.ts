import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './database.js';
import { cleanupOrphanPhotos } from './media.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const db = openDatabase(config.dataDir);
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(here, '../web');
const serveStatic = here.split(sep).includes('dist') && existsSync(join(staticDir, 'index.html'));
const setupToken = config.setupToken ?? randomBytes(18).toString('base64url');
const removed = cleanupOrphanPhotos(db, config.dataDir);
if (removed) console.log(`已清理 ${removed} 张超过 7 天未使用的照片`);

const app = createApp({ db, dataDir: config.dataDir, setupToken, origins: config.origins, secureCookie: config.secureCookie, staticDir: serveStatic ? staticDir : undefined });
const server = app.listen(config.port, config.host, () => {
  console.log(`WeFood 已启动：http://${config.host}:${config.port}${serveStatic ? '' : '（API，前端由 Vite 提供）'}`);
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get() && !config.setupToken) {
    console.log(`首次初始化令牌（只显示在本机终端，请勿外传）：${setupToken}`);
  }
});
server.on('error', error => {
  console.error(`WeFood 启动失败：${(error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `端口 ${config.port} 已被占用` : error.message}`);
  db.close();
  process.exit(1);
});
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
