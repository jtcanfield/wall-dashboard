/**
 * The dev supervisor.
 *
 * Replaces `concurrently` + `npm -w` + `cross-env` + `nest start --watch`, all
 * of which were part of one problem: **on Windows every one of those layers
 * spawns through a `cmd.exe` shim, and killing a `cmd.exe` does not kill what
 * it started.** The observed tree was eight processes deep, ending in
 *
 *     nest.js start --watch
 *       └── cmd.exe /d /s /c "node ... main.js"
 *             └── node main.js          <- holds :3000
 *
 * so every watch restart killed the shim, orphaned the server, and left the
 * port held by a process with no parent left to reap it. Retrying the bind
 * could never fix that: the holder never exits.
 *
 * This file owns the server's real PID. Three children, each spawned directly
 * as `node <bin>` with no shell:
 *
 *   1. `nest build --watch` — compiler only, never runs the server
 *   2. the server itself, which we start, stop and restart
 *   3. vite
 *
 * On a rebuild the server is killed and **awaited** before the replacement is
 * spawned. Serialising it removes the race rather than retrying through it.
 */
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIST = path.join(ROOT, "server", "dist");
const SERVER_MAIN = path.join(SERVER_DIST, "server", "src", "main.js");
const NEST_BIN = path.join(ROOT, "node_modules", "@nestjs", "cli", "bin", "nest.js");
const VITE_BIN = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

/** TZ here rather than via cross-env — one less shell in the chain. */
const ENV = { ...process.env, TZ: "America/New_York", NODE_ENV: "development" };

const COLORS = { build: "\x1b[90m", server: "\x1b[36m", client: "\x1b[35m" };
const OFF = "\x1b[0m";

/**
 * How the supervisor knows a build finished.
 *
 * Watching `server/dist` with `fs.watch` does not work: `nest build --watch`
 * recreates that directory, which invalidates the watch handle. It fires once
 * and then goes silent forever while the server sits dead — observed exactly
 * that on the first attempt at this file.
 *
 * The compiler already announces itself, so use that. It also behaves better:
 * a build with errors leaves the last working server running instead of
 * killing it for a tree that does not compile.
 */
const TSC_RESULT = /Found (\d+) error/;

/** tsc colourises its output; the result line has to be matched without it. */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
/** If a child ignores the kill, stop waiting and say so rather than hanging. */
const EXIT_TIMEOUT_MS = 5_000;

const children = new Set();
let shuttingDown = false;

function label(name) {
    return `${COLORS[name] ?? ""}[${name}]${OFF}`;
}

function log(name, line) {
    console.log(`${label(name)} ${line}`);
}

function pipe(child, name, onLine) {
    for (const stream of [child.stdout, child.stderr]) {
        stream?.setEncoding("utf8");
        let partial = "";
        stream?.on("data", (chunk) => {
            const lines = (partial + chunk).split(/\r?\n/);
            partial = lines.pop() ?? "";
            for (const line of lines) {
                if (line.trim()) {
                    log(name, line);
                    onLine?.(line.replace(ANSI, ""));
                }
            }
        });
    }
}

function launch(name, args, cwd, onLine) {
    // `process.execPath` with the bin's .js path, never the .cmd shim in
    // node_modules/.bin — that shim is the cmd.exe layer this file exists to
    // remove. `shell: false` is the default and is load-bearing.
    const child = spawn(process.execPath, args, {
        cwd,
        env: ENV,
        stdio: ["ignore", "pipe", "pipe"],
    });
    pipe(child, name, onLine);
    children.add(child);
    child.on("exit", (code, signal) => {
        children.delete(child);
        if (shuttingDown) {
            return;
        }
        if (name === "server") {
            // Expected during a restart, which is why it is not fatal. But a
            // server that dies on its own otherwise says nothing at all, and
            // the page just stops updating — say so instead.
            if (!restarting) {
                log("server", `exited on its own (${signal ?? code}) — save a file to restart it`);
            }
            return;
        }
        log(name, `exited (${signal ?? code}) — shutting down`);
        void shutdown(1);
    });
    return child;
}

/**
 * Windows has no graceful signal to send another process, and killing a parent
 * does not touch its children — so `taskkill /T` is the only thing that reaches
 * the whole tree (vite spawns esbuild, nest spawns tsc). On POSIX a plain
 * SIGTERM lets main.ts run its shutdown hook and close the socket cleanly.
 */
function killTree(child) {
    if (!child?.pid || child.exitCode !== null) {
        return;
    }
    if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
        });
    } else {
        child.kill("SIGTERM");
    }
}

let server = null;
let restartQueued = false;
let restarting = false;

function startServer() {
    if (!existsSync(SERVER_MAIN)) {
        log("server", `no build output at ${path.relative(ROOT, SERVER_MAIN)} — waiting`);
        return;
    }
    server = launch("server", ["--enable-source-maps", SERVER_MAIN], ROOT);
}

async function restartServer() {
    if (restarting) {
        restartQueued = true;
        return;
    }
    restarting = true;

    if (server && server.exitCode === null) {
        const exited = once(server, "exit");
        killTree(server);
        // Awaiting the exit is the entire fix. The replacement is not spawned
        // until the outgoing process is gone and the OS has released :3000, so
        // there is no window in which both exist and nothing to retry.
        const timeout = new Promise((resolve) =>
            setTimeout(() => resolve("timeout"), EXIT_TIMEOUT_MS),
        );
        if ((await Promise.race([exited, timeout])) === "timeout") {
            log("server", "did not exit within 5s — starting anyway, expect a bind failure");
        }
    }
    server = null;
    startServer();

    restarting = false;
    if (restartQueued) {
        restartQueued = false;
        void restartServer();
    }
}

async function shutdown(code = 0) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    console.log("");
    log("dev", "stopping");
    for (const child of children) {
        killTree(child);
    }
    // Give taskkill a moment to land before the supervisor's own exit.
    setTimeout(() => process.exit(code), 300);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => void shutdown(0));
}

launch("build", [NEST_BIN, "build", "--watch"], path.join(ROOT, "server"), (line) => {
    const result = TSC_RESULT.exec(line);
    if (!result) {
        return;
    }
    if (result[1] !== "0") {
        log("build", "build failed — leaving the running server up");
        return;
    }
    void restartServer();
});

launch("client", [VITE_BIN], path.join(ROOT, "client"));
