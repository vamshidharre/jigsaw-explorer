// Runs the API/WebSocket server and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.API_PORT ?? '3001' } }),
  spawn('npm', ['run', 'dev:client'], { stdio: 'inherit' }),
];

const shutdown = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
for (const p of procs) p.on('exit', (code) => { if (code) shutdown(); });
