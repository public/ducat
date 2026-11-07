// Playwright: bundles page.ts and runs it in Chromium, Firefox and WebKit (playwright.config.ts).
import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { PageResult } from './page.js';

const seed = process.env.DUCAT_SEED ? Number(process.env.DUCAT_SEED) : 42;
const numRuns = Number(process.env.DUCAT_BROWSER_RUNS ?? 300);
const MINIMUM_PASSED_CHECKS = 10;

const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL('./page.ts', import.meta.url))],
  bundle: true,
  format: 'iife',
  globalName: 'ducatPage',
  platform: 'browser',
  target: 'es2023',
  write: false,
}).outputFiles[0]!.text;

test('suite subset and Intl behaviour in the page', async ({ page }, testInfo) => {
  await page.setContent('<!doctype html><title>ducat</title>');
  await page.addScriptTag({ content: bundle });

  const result: PageResult = await page.evaluate(
    ([pageSeed, pageRuns]) => {
      const exported = (globalThis as unknown as { ducatPage: typeof import('./page.js') })
        .ducatPage;
      return exported.run(pageSeed, pageRuns);
    },
    [seed, numRuns] as const,
  );

  testInfo.annotations.push({
    type: 'engine',
    description: `${result.userAgent}; Intl exact on strings: ${result.intlFormatsStringsExactly}; seed ${seed}`,
  });
  expect(result.failures).toEqual([]);
  // the fixed checks and properties in page.ts; fewer means some did not run
  expect(result.passed).toBeGreaterThanOrEqual(MINIMUM_PASSED_CHECKS);
});
