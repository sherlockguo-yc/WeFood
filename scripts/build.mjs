import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bin = name => fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url));
rmSync('dist', { recursive: true, force: true });
execFileSync(bin('tsc'), ['-p', 'tsconfig.server.json'], { stdio: 'inherit' });
execFileSync(bin('vite'), ['build'], { stdio: 'inherit' });
cpSync('server/migrations', 'dist/server/migrations', { recursive: true });
console.log('WeFood 构建完成：dist/server + dist/web');
