import express from 'express';
import { join } from 'node:path';
import type { FoodDB } from './database.js';
import { authSystem } from './auth.js';
import { errorHandler } from './errors.js';
import { insightsRouter } from './insights.js';
import { libraryRouter } from './library.js';
import { mediaRouter } from './media.js';
import { publicShareRouter, shareRouter } from './shares.js';
import { mapsRouter, type MapsConfig } from './maps.js';
import { dishReferencesRouter } from './dish-references.js';

export type AppOptions = { db: FoodDB; dataDir: string; setupToken: string; origins: string[]; secureCookie: boolean; staticDir?: string; maps?: MapsConfig; mapsFetch?: typeof fetch };

export function createApp(o: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    next();
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '1mb' }));

  const auth = authSystem(o);
  app.use(auth.attach);
  app.get('/api/health', (_req, res) => { res.json({ data: { ok: true } }); });
  app.use('/api/public', publicShareRouter(o.db, o.dataDir));
  app.use('/api', auth.protect);
  app.use('/api/auth', auth.router);
  app.use('/api', auth.requireAuth);
  app.use('/api/maps', mapsRouter(o.db, o.maps, o.mapsFetch));
  app.use('/api', mediaRouter(o.db, o.dataDir));
  app.use('/api', shareRouter(o.db));
  app.use('/api', insightsRouter(o.db));
  app.use('/api', dishReferencesRouter());
  app.use('/api', libraryRouter(o.db));
  app.use('/api', (_req, res) => { res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }); });

  if (o.staticDir) {
    const staticDir = o.staticDir;
    app.use(express.static(staticDir, { index: false, setHeaders: res => res.setHeader('Cache-Control', 'no-cache, must-revalidate') }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }
      if (req.path.startsWith('/s/')) res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
      res.set('Cache-Control', 'no-cache, must-revalidate');
      res.sendFile(join(staticDir, 'index.html'));
    });
  }
  app.use(errorHandler);
  return app;
}
