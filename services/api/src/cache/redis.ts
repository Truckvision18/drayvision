import { Redis } from 'ioredis';
import type { Cache } from './cache.js';

export class RedisCache implements Cache {
  private readonly client: Redis;

  constructor(url: string, private readonly prefix: string) {
    this.client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false });
    // Errors surface via ping()/health; don't crash the process on a transient disconnect.
    this.client.on('error', () => undefined);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(this.prefix + key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.client.set(this.prefix + key, value, 'EX', ttlSeconds);
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.client.disconnect();
  }
}
