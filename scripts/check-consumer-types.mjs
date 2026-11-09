// Type-checks the packed package from three kinds of TypeScript project: CommonJS with node10
// resolution (no `exports` support, so it needs `types` and `typesVersions`), nodenext, and
// bundler. Each project imports every entry and uses a value, so a missing or wrong types path
// fails with TS2307 or a type error.
//
// Usage: node scripts/check-consumer-types.mjs [path/to/package.tgz]
// Without a tarball it builds and packs the package first.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'ducat-consumers-'));
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

const projects = {
  commonjs: { module: 'commonjs', moduleResolution: 'node10' },
  nodenext: { module: 'nodenext', moduleResolution: 'nodenext' },
  bundler: { module: 'esnext', moduleResolution: 'bundler' },
};

// The optional peers some entries' declarations import, linked from this repo's install.
const peers = Object.keys(pkg.peerDependencies ?? {});

try {
  let tarball = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
  if (tarball === undefined) {
    run('pnpm', ['run', 'build'], root);
    const packed = run('pnpm', ['pack', '--pack-destination', work], root).trim().split('\n');
    tarball = packed.at(-1);
  }

  const subpaths = Object.keys(pkg.exports).filter((key) => key !== './package.json');
  const imports = subpaths
    .map((key, i) => `import * as entry${i} from '${pkg.name}${key.slice(1)}';`)
    .join('\n');
  const uses = subpaths.map((_, i) => `entry${i}`).join(', ');
  const source = `${imports}
import { money, type Money } from '${pkg.name}';
import { fixed } from '${pkg.name}/fixed';

const total: Money<'EUR'> = money('12.34', 'EUR').add(money('1', 'EUR'));
// @ts-expect-error: a string is not Money
total.add('1');
export const results: [string, string] = [total.toDecimal(), fixed('1.5').toString()];
export const entries = [${uses}];
`;

  const failures = [];
  for (const [name, options] of Object.entries(projects)) {
    const dir = join(work, name);
    const installed = join(dir, 'node_modules', ...pkg.name.split('/'));
    mkdirSync(installed, { recursive: true });
    run('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1'], dir);
    for (const peer of peers) {
      const target = join(dir, 'node_modules', ...peer.split('/'));
      mkdirSync(join(target, '..'), { recursive: true });
      symlinkSync(join(root, 'node_modules', peer), target);
    }
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: `consumer-${name}`,
        private: true,
        type: name === 'commonjs' ? 'commonjs' : 'module',
      }),
    );
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          ...options,
          target: 'es2022',
          lib: ['es2023', 'esnext.intl', 'dom'],
          strict: true,
          noEmit: true,
          // the optional peers' own declarations aren't under test
          skipLibCheck: true,
          types: [],
        },
        files: ['index.ts'],
      }),
    );
    writeFileSync(join(dir, 'index.ts'), source);
    try {
      run(join(root, 'node_modules', '.bin', 'tsc'), ['-p', dir], dir);
      console.log(`${name}: ok (${subpaths.length} entries)`);
    } catch (error) {
      failures.push(name);
      console.error(`${name}: failed\n${error.stdout}${error.stderr}`);
    }
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
