import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { fromRoot } from '../paths.js';

/**
 * Apply migrations/*.sql in order, each in its own transaction, skipping ones already recorded
 * in schema_migrations (each file records itself). The local Postgres container runs the same
 * files on first boot via docker-entrypoint-initdb.d.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const dir = fromRoot('services/api/migrations');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const applied = new Set<string>();
    const exists = await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok");
    if (exists.rows[0]?.ok) {
      for (const r of (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows) applied.add(r.version);
    }
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      const version = f.replace(/\.sql$/, '');
      if (applied.has(version)) {
        console.log(`skip  ${f} (applied)`);
        continue;
      }
      console.log(`apply ${f}`);
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, f), 'utf8'));
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
