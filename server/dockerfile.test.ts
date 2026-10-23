import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every project file the server loads at runtime, following relative imports from server/index.ts. */
function runtimeFiles(): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    // static and dynamic imports of project files (type-only imports are erased and don't load)
    for (const m of src.matchAll(/(?:^|\n)\s*(import(?!\s+type\b)[^'"]*?from\s*|import\s*\(\s*|export\s+[^'"]*?from\s*)['"](\.{1,2}\/[^'"]+)['"]/g))
      visit(resolve(dirname(file), m[2]!));
    // worker threads load their own file
    for (const m of src.matchAll(/new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) visit(resolve(dirname(file), m[1]!));
  };
  visit(join(ROOT, 'server', 'index.ts'));
  return [...seen].map(f => relative(ROOT, f).replace(/\\/g, '/'));
}

it('the Docker image contains every file the server loads', () => {
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
  // COPY lines in the final stage that copy project files (not --from=build)
  const finalStage = dockerfile.slice(dockerfile.lastIndexOf('FROM '));
  const copied = [...finalStage.matchAll(/^COPY (?!--from)(\S+)\s/gm)].map(m => m[1]!);
  const missing = runtimeFiles().filter(f => !copied.some(c => f === c || f.startsWith(`${c}/`)));
  expect(missing).toEqual([]);
});
