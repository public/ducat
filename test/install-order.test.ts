// A program that imports only /fn and defines a core method name with extendMoney: the root entry,
// imported afterwards, must refuse to replace it. Run in its own file: vitest gives each file a fresh
// module registry, so Money has no core methods here until the root entry is imported.
import { expect, it } from 'vitest';
import '../src/plugins/iso.js';
import { extendMoney, money } from '../src/fn.js';

it('importing the root entry after extendMoney({ add }) throws instead of replacing add', async () => {
  // bun test shares one process across files, where another file may have installed the methods
  if (typeof (money('1', 'EUR') as unknown as { add?: unknown }).add === 'function') {
    return;
  }
  const userAdd = () => 'user';
  extendMoney({ add: userAdd });
  await expect(import('../src/index.js')).rejects.toThrow(/defined before the core methods/);
  expect((money('1', 'EUR') as unknown as { add: unknown }).add).toBe(userAdd);
});
