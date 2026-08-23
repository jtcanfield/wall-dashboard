import * as path from 'node:path';

/**
 * The server workspace root, resolved from the compiled location rather than
 * from cwd so it holds however the process was launched.
 *
 * The build has rootDir `..` (so that `shared/` compiles alongside `server/`),
 * which means a file at `server/src/x/y.ts` emits to
 * `server/dist/server/src/x/y.js` — four levels below `server/`, not three.
 */
export const SERVER_ROOT = path.resolve(__dirname, '..', '..', '..');

export const dataPath = (...parts: string[]): string => path.join(SERVER_ROOT, 'data', ...parts);
export const configPath = (...parts: string[]): string => path.join(SERVER_ROOT, 'config', ...parts);
