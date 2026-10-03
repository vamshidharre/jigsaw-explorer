// Start-up entry for `npm start` and for hosts configured with `node server.js`
// (the original prototype's start command). Builds first if no build exists.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const entry = new URL('./dist/server/index.js', import.meta.url);

if (!existsSync(entry)) {
  console.log('[jigbee] No build found in dist/; running `npm run build` first…');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'build'], { stdio: 'inherit' });
  if (result.status !== 0 || !existsSync(entry)) {
    console.error('[jigbee] Build failed. Use the build command `npm ci --include=dev && npm run build` and the start command `npm start`.');
    process.exit(1);
  }
}

process.env.JIGSAW_AUTOSTART = '1';
await import(entry.href);
