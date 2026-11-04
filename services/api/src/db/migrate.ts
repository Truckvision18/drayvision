import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { fromRoot } from '../paths.js';

/** Apply every migrations/*.sql in order. Migrations are idempotent (IF NOT EXISTS). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const dir = fromRoot('services/api/migrations');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      console.log(`applying ${f}`);
      await client.query(readFileSync(join(dir, f), 'utf8'));
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
