import { networkInterfaces } from 'node:os';

/**
 * Best-guess LAN address of this machine, for logging the URL to open on the
 * laptop. Dev convenience only — nothing depends on it being right.
 *
 * Virtual adapters (Hyper-V, WSL, VPNs, Docker) hand out addresses that look
 * perfectly valid and route nowhere useful, so prefer a private range that
 * isn't one of the usual virtual-switch subnets.
 */
export function lanAddress(): string | null {
  const candidates: string[] = [];

  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (/^(vEthernet|WSL|Loopback|Docker|VirtualBox|VMware)/i.test(name)) continue;
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      candidates.push(addr.address);
    }
  }

  // 192.168.x is the overwhelmingly likely home LAN; 172.17–31 is Docker's.
  return (
    candidates.find((a) => a.startsWith('192.168.')) ??
    candidates.find((a) => a.startsWith('10.')) ??
    candidates[0] ??
    null
  );
}
