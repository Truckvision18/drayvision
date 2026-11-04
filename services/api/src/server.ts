import { buildApp } from './app.js';
import { createContext } from './bootstrap.js';

async function main(): Promise<void> {
  const ctx = createContext();
  const app = buildApp(ctx, { logger: true });
  const close = async (): Promise<void> => {
    await app.close();
    await Promise.allSettled([ctx.cache.close(), ctx.repo.close()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void close());
  process.on('SIGINT', () => void close());
  await app.listen({ host: ctx.config.server.host, port: ctx.config.server.port });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
