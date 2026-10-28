import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = name => fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url));
const children = [
  spawn(bin('tsx'), ['watch', 'server/index.ts'], { stdio: 'inherit', env: process.env }),
  spawn(bin('vite'), [], { stdio: 'inherit', env: process.env })
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const child of children) child.on('exit', code => stop(code ?? 0));
