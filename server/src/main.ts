import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { AppModule } from './app.module';
import { SERVER_ROOT } from './paths';
import { lanAddress } from './net';
import { TIMEZONE } from './sources/stagger';

/**
 * Two deployments, deliberately different shapes:
 *
 * - **Production (the Wyse).** One process. Nest serves the API *and* the built
 *   client on :3000, Chromium runs against localhost, and nothing crosses the
 *   network. This is the real target.
 * - **Development (desktop + laptop).** Nest serves API only; Vite serves the
 *   client on :5173 with HMR and proxies /api back here. The laptop drives the
 *   living room TV and views the desktop over the LAN.
 *
 * The split is driven by NODE_ENV, which the dev npm script sets.
 */
const isDev = process.env.NODE_ENV === 'development';

async function bootstrap(): Promise<void> {
  const log = new Logger('Bootstrap');

  // Every timestamp in this app is local wall-clock. If the process isn't in
  // the expected zone, the commute markers and luften windows quietly shift.
  if (process.env.TZ !== TIMEZONE) {
    log.warn(`TZ is "${process.env.TZ ?? 'unset'}", expected "${TIMEZONE}" — use the npm scripts`);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const clientDist = path.join(SERVER_ROOT, '..', 'client', 'dist');
  if (isDev) {
    // Not serving it in dev is the point: client/dist is whatever was built
    // last, so serving it here would let :3000 quietly hand out a stale bundle
    // while Vite on :5173 shows the live one. Two URLs, two different apps, no
    // indication which you are looking at.
    log.log('Dev mode — client is served by Vite on :5173, not from here');
  } else if (existsSync(clientDist)) {
    app.useStaticAssets(clientDist);
    log.log(`Serving client bundle from ${clientDist}`);
  } else {
    log.warn(`No client bundle at ${clientDist} — run "npm run build" before "npm start"`);
  }

  const port = Number(process.env.PORT ?? 3000);
  // 0.0.0.0, not localhost — in dev the laptop on the TV views this over the
  // LAN, and Nest (like Vite) defaults to localhost only.
  await app.listen(port, '0.0.0.0');

  const lan = lanAddress();
  log.log(`API listening on 0.0.0.0:${port} (TZ=${process.env.TZ})`);
  if (isDev) {
    log.log(`  local     http://localhost:${port}/api/health`);
    if (lan) log.log(`  LAN       http://${lan}:${port}/api/health`);
    log.log(`  open the dashboard at http://${lan ?? 'localhost'}:5173`);
  }
}

void bootstrap();
