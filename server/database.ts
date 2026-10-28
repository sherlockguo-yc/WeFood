import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function openDatabase(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dataDir, 'wefood.sqlite'));
  db.pragma('foreign_keys = ON'); db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000');
  db.exec(readFileSync(new URL('./migrations/001-core.sql', import.meta.url), 'utf8'));
  return db;
}
export type FoodDB = ReturnType<typeof openDatabase>;
