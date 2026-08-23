import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';
import { networkInterfaces } from 'node:os';

const API_PORT = Number(process.env.PORT ?? 3000);

/**
 * Best-guess LAN address, used to pin HMR. Deliberately duplicated from
 * server/src/net.ts rather than shared: this runs in Vite's own esbuild-loaded
 * config, on the other side of the wire, and `shared/` is the DashboardState
 * contract — not a utility bin.
 */
function lanAddress(): string | undefined {
  const candidates: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (/^(vEthernet|WSL|Loopback|Docker|VirtualBox|VMware)/i.test(name)) continue;
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) candidates.push(addr.address);
    }
  }
  return (
    candidates.find((a) => a.startsWith('192.168.')) ??
    candidates.find((a) => a.startsWith('10.')) ??
    candidates[0]
  );
}

// Override if auto-detection picks the wrong adapter (VPN, second NIC).
const devHost = process.env.DASHBOARD_DEV_HOST ?? lanAddress();

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    // Binds 0.0.0.0. Vite defaults to localhost, which is invisible from the
    // laptop that drives the living room TV.
    host: true,
    port: 5173,
    // Fail loudly rather than silently sliding to 5174 — the laptop is a kiosk
    // with a hardcoded URL and nobody is there to notice the port moved.
    strictPort: true,
    // Raw IPs are always permitted; this covers reaching the desktop by
    // hostname (e.g. http://desktop.local:5173) without a 403 host check.
    allowedHosts: true,
    // Keeps /api same-origin in dev, so CORS never comes up. This proxies the
    // SSE stream too — http-proxy pipes the response through unbuffered, which
    // is what lets EventSource work across it.
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: false,
        // The dashboard stream is open for the life of the page.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
    // Without this the HMR websocket can resolve to a host the laptop cannot
    // reach; page loads keep working while HMR silently stops, which is a
    // genuinely confusing failure to debug from across the house.
    hmr: devHost ? { host: devHost } : true,
  },
  build: { target: 'es2022' },
});
