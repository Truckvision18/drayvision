import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rightsRegistry } from '../src/rights/registry.js';
import { renderRightsMarkdown } from '../src/rights/render.js';
import { repoRoot } from '../src/paths.js';

const out = resolve(repoRoot, 'docs/RIGHTS.md');
writeFileSync(out, renderRightsMarkdown(rightsRegistry));
console.log(`wrote ${out}`);
