// every ISO 4217 code: this file builds Money from /fn-level modules, which don't register them
import '../src/plugins/iso.js';
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

// Static imports and re-exports (`from './fetch.js'`), side-effect imports and dynamic import(),
// with either quote, with or without the extension.
const IMPORTS_FETCH =
  /(?:\bfrom|\bimport)\s*\(?\s*['"]\.{1,2}\/(?:[\w./-]*\/)?fetch(?:\.[jt]s)?['"]/;

// A fetch that never answers until its signal aborts it.
const hanging: Fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });

describe('fetchEcb', () => {
  it('fetches and parses, with an injected fetch', async () => {
    const seen: unknown[] = [];
    const signal = new AbortController().signal;
    const [latest] = await fetchEcb({ fetch: fake(200, daily, seen), signal, timeout: 0 });
    expect(latest?.rate('EUR', 'USD')?.toString()).toBe('1.1165');
    expect(seen).toEqual([[ECB_URLS.daily, { headers: { accept: 'application/xml' }, signal }]]);
    await fetchEcb({ fetch: fake(200, daily, seen), history: '90d' });
    expect((seen[1] as string[])[0]).toBe(ECB_URLS['90d']);
  });

  it('reports HTTP and format errors', async () => {
    await expect(fetchEcb({ fetch: fake(503, '') })).rejects.toThrow(FetchRatesError);
    await expect(fetchEcb({ fetch: fake(503, '') })).rejects.toMatchObject({
      status: 503,
      url: ECB_URLS.daily,
    });
    await expect(fetchEcb({ fetch: fake(200, '<html/>') })).rejects.toThrow(SyntaxError);
    await expect(fetchEcb({ fetch: fake(200, '<html/>') })).rejects.toThrow(ECB_URLS.daily);
  });

  it('times out by default, and combines a timeout with the caller signal', async () => {
    const seen: Array<[string, { signal?: AbortSignal }]> = [];
    const recording = fake(200, daily, seen);
    await fetchEcb({ fetch: recording });
    expect(seen[0]![1].signal).toBeInstanceOf(AbortSignal);
    const controller = new AbortController();
    await fetchEcb({ fetch: recording, signal: controller.signal });
    const combined = seen[1]![1].signal!;
    expect(combined).not.toBe(controller.signal);
    controller.abort();
    expect(combined.aborted).toBe(true);
    await fetchEcb({ fetch: recording, timeout: 0 });
    expect(seen[2]![1].signal).toBeUndefined();
    await expect(fetchEcb({ fetch: hanging, timeout: 20 })).rejects.toHaveProperty(
      'name',
      'TimeoutError',
    );
    await expect(fetchEcb({ fetch: recording, timeout: -1 })).rejects.toThrow(RangeError);
  });

  it('is imported by no other module, except its published entry', () => {
    const dir = new URL('../src/', import.meta.url);
    const importers = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.ts') && file !== 'fetch.ts' && file !== 'entries/fetch.ts')
      .filter((file) => IMPORTS_FETCH.test(readFileSync(new URL(file, dir), 'utf8')));
    expect(importers).toEqual([]);
    for (const line of [
      `import { fetchEcb } from './fetch.js';`,
      `export * from "../fetch.js";`,
      `import './fetch.js';`,
      `const module = await import("./fetch.js");`,
      `await import ( '../src/fetch' )`,
    ]) {
      expect([line, IMPORTS_FETCH.test(line)]).toEqual([line, true]);
    }
    expect(IMPORTS_FETCH.test(`import { parseEcbXml } from './ecb.js';`)).toBe(false);
    expect(IMPORTS_FETCH.test(`const response = await fetch(url);`)).toBe(false);
  });
});
