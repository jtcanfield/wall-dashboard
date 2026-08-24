import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface PortHolder {
    pid: number;
    name: string;
}

/**
 * Who is listening on `port`, for diagnostics only.
 *
 * A watch restart frees the port on its own, but an orphan left behind by a
 * killed terminal never will — and the two are indistinguishable from a failed
 * bind alone. Naming the process turns "EADDRINUSE" into something the reader
 * can act on. Best-effort: returns null rather than throwing.
 */
export async function findPortHolder(port: number): Promise<PortHolder | null> {
    try {
        if (process.platform === "win32") {
            const { stdout } = await run(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
                        `if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; "$($c.OwningProcess) $($p.ProcessName)" }`,
                ],
                { windowsHide: true, timeout: 5_000 },
            );
            const [pid, name] = stdout.trim().split(/\s+/);
            return pid ? { pid: Number(pid), name: name ?? "unknown" } : null;
        }

        const { stdout } = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], {
            timeout: 5_000,
        });
        const pid = /^p(\d+)/m.exec(stdout)?.[1];
        const name = /^c(.+)/m.exec(stdout)?.[1];
        return pid ? { pid: Number(pid), name: name ?? "unknown" } : null;
    } catch {
        return null;
    }
}
