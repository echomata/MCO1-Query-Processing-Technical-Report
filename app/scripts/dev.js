import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(new URL('../server/.env', import.meta.url)) && process.env.DB_PASSWORD === undefined) {
  console.error('Copy server/.env.example to server/.env and set your MySQL password first.');
  process.exit(1);
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const args of [['--watch', 'server/index.js'], ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1']]) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code || 0); });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());