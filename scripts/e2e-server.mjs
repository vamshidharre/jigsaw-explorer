// Starts the production build on a throwaway data directory for end-to-end tests.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dataDir = mkdtempSync(path.join(tmpdir(), 'jigsaw-e2e-'));
const child = spawn(process.execPath, ['dist/server/index.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    DATA_DIR: dataDir,
    TRUST_PROXY: '0',
    RECONNECT_GRACE_SECONDS: process.env.RECONNECT_GRACE_SECONDS ?? '8',
    LOG_LEVEL: 'warn',
  },
});
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
