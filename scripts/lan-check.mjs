/**
 * Preflight for the desktop -> laptop dev setup.
 *
 * Everything here is a thing that fails *silently* from the laptop's point of
 * view: the page just never loads, and you are standing in the living room
 * with no way to tell which of five causes it is. Run this on the desktop.
 */
import { networkInterfaces } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createConnection } from "node:net";

const run = promisify(execFile);

const API_PORT = Number(process.env.PORT ?? 3000);
const VITE_PORT = 5173;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const OFF = "\x1b[0m";

const ok = (m, d) => console.log(`  ${GREEN}OK${OFF}    ${m}${d ? `  ${DIM}${d}${OFF}` : ""}`);
const bad = (m, d) =>
    console.log(`  ${RED}FAIL${OFF}  ${m}${d ? `\n        ${DIM}${d}${OFF}` : ""}`);
const warn = (m, d) =>
    console.log(`  ${YELLOW}WARN${OFF}  ${m}${d ? `\n        ${DIM}${d}${OFF}` : ""}`);

let failures = 0;
const fail = (m, d) => {
    failures++;
    bad(m, d);
};

function lanAddress() {
    const candidates = [];
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
        if (/^(vEthernet|WSL|Loopback|Docker|VirtualBox|VMware)/i.test(name)) {
            continue;
        }
        for (const addr of addrs ?? []) {
            if (addr.family === "IPv4" && !addr.internal) {
                candidates.push({ name, address: addr.address });
            }
        }
    }
    return candidates;
}

const ps = async (script) => {
    const { stdout } = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
            windowsHide: true,
        },
    );
    return stdout.trim();
};

/** Can something actually accept a TCP connection on this address:port? */
const probe = (host, port) =>
    new Promise((resolve) => {
        const socket = createConnection({ host, port, timeout: 1500 });
        socket.on("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.on("error", () => resolve(false));
        socket.on("timeout", () => {
            socket.destroy();
            resolve(false);
        });
    });

console.log(`\n${BOLD}Wall dashboard — LAN dev preflight${OFF}\n`);

// ---------------------------------------------------------------- address
const addresses = lanAddress();
const ip = process.env.DASHBOARD_DEV_HOST ?? addresses[0]?.address;

if (!ip) {
    fail("No LAN address found", "Is the Ethernet cable in?");
} else if (addresses.length > 1) {
    warn(
        `Multiple LAN addresses — using ${ip}`,
        `${addresses.map((a) => `${a.address} (${a.name})`).join(", ")}\n        ` +
            "Pin the right one with DASHBOARD_DEV_HOST=<ip> if this is wrong.",
    );
} else {
    ok("LAN address", `${ip} (${addresses[0].name})`);
}

// --------------------------------------------------------- network profile
try {
    const profile = await ps(
        '(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -eq "Internet" } | Select-Object -First 1).NetworkCategory',
    );
    if (profile === "Private" || profile === "DomainAuthenticated") {
        ok("Network profile", profile);
    } else {
        fail(
            `Network profile is ${profile || "unknown"}`,
            "Windows blocks all inbound connections on a Public network and no " +
                "Private-profile firewall rule will help.\n        " +
                "Settings -> Network & Internet -> Ethernet -> set to Private.",
        );
    }
} catch {
    warn("Could not read network profile", "PowerShell unavailable?");
}

// ----------------------------------------------------------- firewall rule
try {
    const nodePath = process.execPath.toLowerCase();
    const rules = await ps(
        "Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow | " +
            "ForEach-Object { $pf = $_ | Get-NetFirewallPortFilter; $af = $_ | Get-NetFirewallApplicationFilter; " +
            '"$($_.Profile)|$($pf.LocalPort)|$($af.Program)" } | Out-String',
    );
    const lines = rules
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    const portRule = lines.find(
        (l) =>
            /Private|Any/i.test(l.split("|")[0] ?? "") &&
            /\b(3000|5173)\b/.test(l.split("|")[1] ?? ""),
    );
    const appRule = lines.find((l) => (l.split("|")[2] ?? "").toLowerCase() === nodePath);

    if (portRule) {
        ok("Firewall", `port rule present (${portRule.split("|")[1]})`);
    } else if (appRule) {
        ok("Firewall", "allow rule matches this node.exe");
    } else {
        fail(
            "No inbound firewall rule covers these ports",
            "Any node.exe rules present are scoped to a different node binary than\n        " +
                `the one running here (${process.execPath}).\n        ` +
                "Run this once in an ELEVATED PowerShell:\n\n        " +
                `New-NetFirewallRule -DisplayName "Wall dashboard dev" -Direction Inbound \`\n          ` +
                "-LocalPort 3000,5173 -Protocol TCP -Action Allow -Profile Private\n",
        );
    }
} catch {
    warn("Could not enumerate firewall rules");
}

// ------------------------------------------------------------- listeners
for (const [label, port] of [
    ["API (Nest)", API_PORT],
    ["Client (Vite)", VITE_PORT],
]) {
    const onLoopback = await probe("127.0.0.1", port);
    const onLan = ip ? await probe(ip, port) : false;

    if (!onLoopback) {
        warn(
            `${label} not running on :${port}`,
            'Start it with "npm run dev" and re-run this check.',
        );
    } else if (!onLan) {
        fail(
            `${label} is listening on localhost only`,
            "It must bind 0.0.0.0 to be reachable from the laptop.",
        );
    } else {
        ok(`${label} reachable on the LAN`, `${ip}:${port}`);
    }
}

// ---------------------------------------------------------------- summary
console.log();
if (ip) {
    console.log(`${BOLD}On the laptop, open:${OFF}\n`);
    console.log(`  http://${ip}:${VITE_PORT}\n`);
    console.log(`${BOLD}Or full-screen, as the TV will run it:${OFF}\n`);
    console.log(
        `  chrome.exe --kiosk --noerrdialogs --disable-infobars http://${ip}:${VITE_PORT}\n`,
    );
}

if (failures > 0) {
    console.log(`${RED}${failures} blocking problem(s) above.${OFF}\n`);
    process.exitCode = 1;
} else {
    console.log(`${GREEN}No blocking problems found.${OFF}\n`);
}

// If ping works but the browser does not, it is almost always the router:
console.log(
    `${DIM}If the laptop still cannot connect but both machines have internet:\n` +
        "client/AP isolation between wired and wireless clients (common on mesh systems),\n" +
        `or the laptop is on a guest SSID with no route to the LAN.${OFF}\n`,
);
