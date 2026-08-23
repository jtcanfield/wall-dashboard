/** Node 22 has global fetch, so there is no HTTP client dependency here. */

export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} from ${url}`);
  }
}

/**
 * A fetch with a hard timeout. Every upstream here is a public API on the open
 * internet; an unattended display must never end up with a request hanging
 * long enough to stall the next poll.
 */
export async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

export async function getText(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<string> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(res.status, url);
  return await res.text();
}
