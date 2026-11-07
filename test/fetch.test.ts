import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ECB_URLS, fetchEcb, FetchRatesError, type Fetch } from '../src/fetch.js';

const daily = readFileSync(new URL('fixtures/ecb/eurofxref-daily.xml', import.meta.url), 'utf8');

function fake(status: number, body: string, seen: unknown[] = []): Fetch {
  return async (url, init) => {
    seen.push([url, init]);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
}

describe('fetchEcb', () => {
  it('fetches and parses, with an injected fetch', async () => {
    const seen: unknown[] = [];
    const signal = {};
    const [t] = await fetchEcb({ fetch: fake(200, daily, seen), signal });
    expect(t?.rate('EUR', 'USD')?.toString()).toBe('1.1165');
    expect(seen).toEqual([[ECB_URLS.daily, { headers: { accept: 'application/xml' }, signal }]]);
    await fetchEcb({ fetch: fake(200, daily, seen), history: '90d' });
    expect((seen[1] as string[])[0]).toBe(ECB_URLS['90d']);
  });

  it('reports HTTP and format errors', async () => {
    await expect(fetchEcb({ fetch: fake(503, '') })).rejects.toThrow(FetchRatesError);
    await expect(fetchEcb({ fetch: fake(503, '') })).rejects.toMatchObject({ status: 503, url: ECB_URLS.daily });
    await expect(fetchEcb({ fetch: fake(200, '<html/>') })).rejects.toThrow(SyntaxError);
  });

  it('is imported by no other module', () => {
    const dir = new URL('../src/', import.meta.url);
    const importers = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts') && f !== 'fetch.ts')
      .filter((f) => /from '\.{1,2}\/(?:[\w/]*\/)?fetch\.js'/.test(readFileSync(new URL(f, dir), 'utf8')));
    expect(importers).toEqual([]);
  });
});
