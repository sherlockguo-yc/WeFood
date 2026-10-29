import { resolve } from 'node:path';

import type { MapsConfig } from './maps.js';
import type { CandidateOptions } from './dish-candidates.js';
export type AppConfig = { port: number; host: string; dataDir: string; origins: string[]; secureCookie: boolean; setupToken?: string; maps: MapsConfig; dishCandidates: CandidateOptions };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1-65535 之间的整数');
  const webPort = env.WEB_PORT ?? '4319';
  const fallback = [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`, `http://localhost:${port}`, `http://127.0.0.1:${port}`].join(',');
  const origins = (env.TRUSTED_ORIGINS ?? fallback).split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length) throw new Error('TRUSTED_ORIGINS 至少需要一个地址');
  for (const origin of origins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error(`TRUSTED_ORIGINS 包含无效地址：${origin}`); }
    if (!/^https?:$/.test(url.protocol) || url.origin !== origin) throw new Error(`TRUSTED_ORIGINS 只能填写“协议://域名:端口”：${origin}`);
  }
  const setupToken = env.WEFOOD_SETUP_TOKEN || undefined;
  if (setupToken !== undefined && setupToken.length < 16) throw new Error('WEFOOD_SETUP_TOKEN 至少需要 16 个字符');
  const budget = (key: string, fallback: number) => {
    const v = Number(env[key] || fallback);
    if (!Number.isSafeInteger(v) || v < 1 || v > 10000) throw new Error(`${key} 必须是 1-10000 的整数`);
    return v;
  };
  const maps: MapsConfig = { jsKey: env.WEFOOD_TENCENT_JS_KEY || '', key: env.WEFOOD_TENCENT_KEY || '', sk: env.WEFOOD_TENCENT_SK || '', dailyLimit: budget('WEFOOD_MAPS_DAILY_LIMIT', 100), userDailyLimit: budget('WEFOOD_MAPS_USER_DAILY_LIMIT', 20) };
  const dishCandidates: CandidateOptions = { amapKey: env.WEFOOD_AMAP_KEY || '', dailyLimit: budget('WEFOOD_DISH_DAILY_LIMIT', 100), userDailyLimit: budget('WEFOOD_DISH_USER_DAILY_LIMIT', 20) };
  return { port, host: env.HOST || '127.0.0.1', dataDir: resolve(env.DATA_DIR || 'data'), origins, secureCookie: env.SECURE_COOKIE === 'true', setupToken, maps, dishCandidates };
}
