import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Source files stay ASCII; interface text lives in src/i18n. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (path.endsWith(join('src', 'i18n'))) continue;
      sourceFiles(path, out);
    } else if (/\.(ts|tsx|css)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

describe('source conventions', () => {
  it('keeps non-ASCII characters out of code files', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/[^\x00-\x7f]/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
