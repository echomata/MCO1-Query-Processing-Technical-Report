import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = fileURLToPath(new URL('../server/.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const bundledNgrok = fileURLToPath(new URL(`../.tools/ngrok${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const ngrok = existsSync(bundledNgrok) ? bundledNgrok : 'ngrok';
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}

function launch(command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', (error) => {
    children.delete(child);
    console.error(`Could not launch ${command}: ${error.message}`);
    stop(1);
  });
  return child;
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());

try {
  if (process.env.DB_PASSWORD === undefined) throw new Error('Copy server/.env.example to server/.env and configure MySQL first.');
  const port = Number(process.env.API_PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid port.');
  const ngrokCommand = ngrok === 'ngrok' ? 'ngrok' : '.\\.tools\\ngrok.exe';
  if (spawnSync(ngrok, ['version'], { windowsHide: true, stdio: 'ignore' }).status !== 0) {
    throw new Error('Install ngrok from https://ngrok.com/download/windows. See the README sharing guide.');
  }
  if (!process.env.NGROK_AUTHTOKEN && spawnSync(ngrok, ['config', 'check'], { windowsHide: true, stdio: 'ignore' }).status !== 0) {
    throw new Error(`Authenticate ngrok locally first: ${ngrokCommand} config add-authtoken YOUR_TOKEN\nGet your token at https://dashboard.ngrok.com/get-started/your-authtoken . Do not commit or share the token.`);
  }
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the existing app server with Ctrl+C before running npm run share.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  if (!stopping) {
    console.log('Building the dashboard for sharing...');
    const build = launch(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
    const code = await new Promise((resolve) => {
      build.once('exit', resolve);
      build.once('error', () => resolve(1));
    });
    if (!stopping && code !== 0) throw new Error('The dashboard build failed.');
  }
  if (!stopping) {
    const username = 'team';
    const password = randomBytes(18).toString('base64url');
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const server = launch(process.execPath, ['server/index.js'], {
      ...process.env, METER_SHARE_MODE: '1', METER_SHARE_USER: username, METER_SHARE_PASSWORD: password,
    });
    server.once('exit', (code) => { if (!stopping) stop(code || 1); });
    let ready = false;
    const deadline = Date.now() + 20_000;
    while (!stopping && Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          headers: { authorization }, signal: AbortSignal.timeout(1500),
        });
        if (response.ok && (await response.json()).source === 'warehouse') { ready = true; break; }
      } catch { /* Wait for this server and the database connection. */ }
      await delay(250);
    }
    if (!stopping && !ready) throw new Error('The warehouse is unavailable. Start MySQL and check server/.env, then run npm run share again.');
    if (!stopping) {
      console.log(`Local dashboard: http://127.0.0.1:${port}`);
      console.log(`Sharing username: ${username}\nSharing password: ${password}`);
      console.log('Share the HTTPS Forwarding URL below and these login details privately with your team.');
      console.log('Keep this terminal open. Ctrl+C stops both the app and the tunnel.');
      // The agent needs its own configuration, not the database or sharing secrets.
      const tunnelEnv = { ...process.env };
      for (const key of Object.keys(tunnelEnv)) {
        if (key.startsWith('DB_') || key.startsWith('METER_SHARE_')) delete tunnelEnv[key];
      }
      const tunnel = launch(ngrok, ['http', `http://127.0.0.1:${port}`, '--inspect=false'], tunnelEnv);
      tunnel.once('exit', (code) => { if (!stopping) stop(code || 0); });
      // ngrok redraws the terminal when it starts, which can hide the
      // credentials printed immediately before it. Print them once more
      // after the redraw so the presenter can still read them.
      await delay(1000);
      if (!stopping) {
        console.log('');
        console.log(`Sharing username: ${username}`);
        console.log(`Sharing password: ${password}`);
        console.log('Keep these credentials private.');
      }
    }
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}