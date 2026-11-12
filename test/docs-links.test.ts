// Links inside the documentation must resolve: a relative link to a file in the repository, and an
// #anchor to a heading in its target, the way GitHub renders them. Pages that moved keep a stub at the
// old path, because published READMEs link to them on main.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_URL = 'https://github.com/public/ducat/';

const DOCUMENTS = [
  'README.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  ...readdirSync(join(ROOT, 'docs'), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.md'))
    .map((path) => `docs/${path.split('\\').join('/')}`),
];

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The anchors a markdown file has: one per heading (repeats get -1, -2...) and explicit ids. */
export function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, '');
  for (const match of prose.matchAll(/^#{1,6} (.+)$/gm)) {
    const base = slug(match[1]!.replace(/`/g, ''));
    const seen = counts.get(base) ?? 0;
    anchors.add(seen === 0 ? base : `${base}-${seen}`);
    counts.set(base, seen + 1);
  }
  for (const match of prose.matchAll(/<a (?:id|name)="([^"]+)"/g)) {
    anchors.add(match[1]!);
  }
  return anchors;
}

/** Every link target in a markdown file, outside code. */
function linkTargets(markdown: string): string[] {
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
  return [...prose.matchAll(/\]\(([^)\s]+)\)|(?:src|href)="([^"]+)"/g)].map(
    (match) => (match[1] ?? match[2])!,
  );
}

/** A link as a repository path and anchor, or undefined for a link outside the repository. */
function resolve(
  from: string,
  target: string,
): { path: string; anchor: string | undefined } | undefined {
  let pathAndAnchor: string;
  if (target.startsWith(`${REPO_URL.slice(0, -1)}#`)) {
    // the repository's front page shows README.md
    pathAndAnchor = `README.md${target.slice(REPO_URL.length - 1)}`;
  } else if (target.startsWith(REPO_URL)) {
    const rest = target.slice(REPO_URL.length);
    const match = /^(?:blob|tree)\/main\/(.*)$/.exec(rest);
    if (!match) {
      return undefined;
    }
    pathAndAnchor = match[1]!;
  } else if (/^[a-z][a-z+.-]*:/i.test(target)) {
    return undefined;
  } else if (target.startsWith('#')) {
    pathAndAnchor = `${from}${target}`;
  } else {
    pathAndAnchor = normalize(join(dirname(from), target))
      .split('\\')
      .join('/');
  }
  const [path, anchor] = pathAndAnchor.split('#');
  return { path: path!.replace(/\/$/, ''), anchor };
}

describe('documentation links', () => {
  for (const document of DOCUMENTS) {
    it(`every link in ${document} resolves`, () => {
      const broken: string[] = [];
      for (const target of linkTargets(readFileSync(join(ROOT, document), 'utf8'))) {
        const resolved = resolve(document, target);
        if (resolved === undefined) {
          continue;
        }
        const file = join(ROOT, resolved.path);
        if (!existsSync(file)) {
          broken.push(`${target}: no such file`);
          continue;
        }
        if (resolved.anchor && resolved.path.endsWith('.md')) {
          if (!anchorsOf(readFileSync(file, 'utf8')).has(resolved.anchor)) {
            broken.push(`${target}: no heading #${resolved.anchor} in ${resolved.path}`);
          }
        }
      }
      expect(broken).toEqual([]);
    });
  }

  it('reads anchors the way GitHub makes them', () => {
    expect(slug("What's missing (honest list)")).toBe('whats-missing-honest-list');
    expect(slug('`@ducatjs/money/finance`: design')).toBe('ducatjsmoneyfinance-design');
    expect([...anchorsOf('# A\n## A\n```\n# not a heading\n```\n')]).toEqual(['a', 'a-1']);
  });

  // the 0.2 and 0.3 READMEs on npm link to these on main
  it.each([
    ['docs/COMPARISON.md', 'explanation/comparison.md'],
    ['docs/FINANCE.md', 'explanation/finance-design.md'],
  ])('%s still exists and links to %s', (stub, target) => {
    const text = readFileSync(join(ROOT, stub), 'utf8');
    expect(linkTargets(text)).toContain(target);
  });

  it('the old deep link to the fixed-point comparison still lands on its section', () => {
    const stub = readFileSync(join(ROOT, 'docs/COMPARISON.md'), 'utf8');
    expect(anchorsOf(stub).has('fixed-point-decimal-libraries')).toBe(true);
    expect(linkTargets(stub)).toContain('explanation/comparison.md#fixed-point-decimal-libraries');
  });
});
