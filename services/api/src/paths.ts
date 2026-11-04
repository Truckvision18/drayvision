import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walk up from this file until we find the monorepo root (has `data/` and `services/`). */
function findRepoRoot(): string {
  if (process.env.DRAYVISION_ROOT) return process.env.DRAYVISION_ROOT;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'data')) && existsSync(resolve(dir, 'services'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export const repoRoot = findRepoRoot();
export const fromRoot = (p: string): string => (isAbsolute(p) ? p : resolve(repoRoot, p));
