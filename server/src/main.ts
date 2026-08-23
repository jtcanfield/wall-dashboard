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

/**
 * `nest start --watch` spawns the replacement process before the outgoing one
 * has released the listening socket, and Windows sets SO_EXCLUSIVEADDRUSE so
 * the new bind is refused outright rather than shared. The old process is on
 * its way out, so the port frees within a few hundred milliseconds — retrying
 * is both the simplest fix and the one that needs no extra tooling.
 *
 * Dev only. In production an occupied port means another dashboard is already
 * running, and failing loudly is correct.
 */
const BIND_RETRY_DELAY_MS = 250;
const BIND_RETRY_ATTEMPTS = 40;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function listenWithRetry(app: NestExpressApplication, port: number, log: Logger): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      // 0.0.0.0, not localhost — in dev the laptop on the TV views this over
      // the LAN, and Nest (like Vite) defaults to localhost only.
      await app.listen(port, '0.0.0.0');
      return;
    } catch (err) {
      const isPortBusy = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
      if (!isPortBusy || !isDev || attempt >= BIND_RETRY_ATTEMPTS) {
        throw err;
      }
      if (attempt === 1) {
        log.warn(`Port ${port} still held by the outgoing process, waiting for it to exit`);
      }
      await sleep(BIND_RETRY_DELAY_MS);
    }
  }
}

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

  // Release the listening socket as early as possible on the way out, so the
  // replacement process spends less time retrying its bind.
  app.enableShutdownHooks();
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      if (closing) {
        return;
      }
      closing = true;
      void app.close().finally(() => {
        process.exit(0);
      });
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  await listenWithRetry(app, port, log);

  const lan = lanAddress();
  log.log(`API listening on 0.0.0.0:${port} (TZ=${process.env.TZ})`);
  if (isDev) {
    log.log(`  local     http://localhost:${port}/api/health`);
    if (lan) {
      log.log(`  LAN       http://${lan}:${port}/api/health`);
    }
    log.log(`  open the dashboard at http://${lan ?? 'localhost'}:5173`);
  }
}

void bootstrap();
