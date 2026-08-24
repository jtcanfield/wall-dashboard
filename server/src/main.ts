import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { AppModule } from "./app.module";
import { SERVER_ROOT } from "./paths";
import { lanAddress } from "./net";
import { TIMEZONE } from "./sources/stagger";
import { findPortHolder } from "./port";

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
const isDev = process.env.NODE_ENV === "development";

/**
 * A short retry on EADDRINUSE, for the case where the outgoing process is on
 * its way out and has not yet released the socket. Windows sets
 * SO_EXCLUSIVEADDRUSE, so the new bind is refused outright rather than shared.
 *
 * `scripts/dev.mjs` now waits for the old server to exit before starting the
 * replacement, so this should never fire in the normal watch loop. It is kept
 * for the case it was always the wrong fix for: an **orphan** holding the port
 * that will never exit. That one used to end in a raw unhandled rejection; it
 * now names the process instead — see the catch in bootstrap.
 *
 * Shorter than it was, because waiting ten seconds to be told the port is busy
 * is worse than being told in two.
 */
const BIND_RETRY_DELAY_MS = 250;
const BIND_RETRY_ATTEMPTS = 8;

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

async function listenWithRetry(
    app: NestExpressApplication,
    port: number,
    log: Logger,
): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            // 0.0.0.0, not localhost — in dev the laptop on the TV views this over
            // the LAN, and Nest (like Vite) defaults to localhost only.
            await app.listen(port, "0.0.0.0");
            return;
        } catch (err) {
            const isPortBusy = (err as NodeJS.ErrnoException).code === "EADDRINUSE";
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
    const log = new Logger("Bootstrap");

    // Every timestamp in this app is local wall-clock. If the process isn't in
    // the expected zone, the commute markers and luften windows quietly shift.
    if (process.env.TZ !== TIMEZONE) {
        log.warn(
            `TZ is "${process.env.TZ ?? "unset"}", expected "${TIMEZONE}" — use the npm scripts`,
        );
    }

    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    const clientDist = path.join(SERVER_ROOT, "..", "client", "dist");
    if (isDev) {
        // Not serving it in dev is the point: client/dist is whatever was built
        // last, so serving it here would let :3000 quietly hand out a stale bundle
        // while Vite on :5173 shows the live one. Two URLs, two different apps, no
        // indication which you are looking at.
        log.log("Dev mode — client is served by Vite on :5173, not from here");
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
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
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
    try {
        await listenWithRetry(app, port, log);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") {
            throw err;
        }
        // The retry is exhausted, so whoever holds the port is not leaving.
        // A stack trace here says nothing useful; the PID does.
        const holder = await findPortHolder(port);
        log.error(
            holder
                ? `Port ${port} is held by ${holder.name} (pid ${holder.pid}) and it is not exiting. ` +
                      `Stop it with: ${
                          process.platform === "win32"
                              ? `taskkill /pid ${holder.pid} /T /F`
                              : `kill ${holder.pid}`
                      }`
                : `Port ${port} is in use and the holder could not be identified.`,
        );
        process.exit(1);
    }

    const lan = lanAddress();
    log.log(`API listening on 0.0.0.0:${port} (TZ=${process.env.TZ})`);
    if (isDev) {
        log.log(`  local     http://localhost:${port}/api/health`);
        if (lan) {
            log.log(`  LAN       http://${lan}:${port}/api/health`);
        }
        log.log(`  open the dashboard at http://${lan ?? "localhost"}:5173`);
    }
}

void bootstrap();
