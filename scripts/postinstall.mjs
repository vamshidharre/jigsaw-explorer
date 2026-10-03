// Builds the app during `npm install` on Render when the service still uses the
// original prototype's settings (build command `npm install`, start command
// `node server.js` or `npm start`), so deploying this version does not need a
// settings change. Everywhere else (local installs, `npm ci`, Docker) it does nothing.
import { spawnSync } from 'node:child_process';

if (process.env.RENDER !== 'true' || process.env.npm_command === 'ci') process.exit(0);

console.log('[jigbee] Render with an install-only build command: building the app now…');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'build'], { stdio: 'inherit' });
if (result.status !== 0) {
  // Failing the install fails the deploy, which keeps the previous version online.
  console.error('[jigbee] Build failed. Set the build command to: npm ci --include=dev && npm run build');
  process.exit(result.status ?? 1);
}
