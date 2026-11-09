import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The README is read from node_modules and from the unpacked tarball as well as on GitHub, so a
// relative link has to point at a file the package ships. Everything else is an absolute URL.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const { files } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  files: string[];
};
// npm always packs these, whatever `files` says
const ALWAYS_PACKED = ['package.json', 'README.md', 'LICENSE'];

/** Whether a path inside the repo is in the packed package. */
function isPacked(path: string): boolean {
  const normalised = path.replace(/^\.\//, '').replace(/\/$/, '');
  return [...ALWAYS_PACKED, ...files].some(
    (entry) => normalised === entry || normalised.startsWith(`${entry}/`),
  );
}

/** Every link target in the README: Markdown links and HTML src/href attributes. */
function linkTargets(text: string): string[] {
  const targets: string[] = [];
  // code blocks hold examples, not links
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const match of prose.matchAll(/\]\(([^)\s]+)\)|(?:src|href)="([^"]+)"/g)) {
    targets.push((match[1] ?? match[2])!);
  }
  return targets;
}

describe('README links work from the published package', () => {
  it('every relative link points at a packed file', () => {
    const relative = linkTargets(readme).filter(
      (target) => !/^[a-z][a-z+.-]*:/i.test(target) && !target.startsWith('#'),
    );
    const missing = relative.filter((target) => !isPacked(target.split('#')[0]!));
    expect(missing).toEqual([]);
    // the check sees the links that are relative on purpose
    expect(relative).toContain('assets/CREDITS.md');
  });

  it('the check catches a relative link to a file the package leaves out', () => {
    const targets = linkTargets('See [the comparison](docs/COMPARISON.md) and [x](#anchor).');
    expect(targets.filter((target) => !target.startsWith('#') && !isPacked(target))).toEqual([
      'docs/COMPARISON.md',
    ]);
    expect(isPacked('dist/index.js')).toBe(true);
    expect(isPacked('CHANGELOG.md')).toBe(false);
  });
});
