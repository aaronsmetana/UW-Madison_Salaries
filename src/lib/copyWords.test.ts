import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Words the app's own text must keep to, read from every string and every piece of JSX text in src with the
 * TypeScript parser (comments and identifiers are not text a reader sees). A query key or a slug — one
 * lower-case word with hyphens — is not text either.
 */
function texts(): { at: string; text: string }[] {
  const root = join(__dirname, '..');
  const files = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'))
    .map((f) => join(root, f));
  const out: { at: string; text: string }[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      let text: string | null = null;
      if (ts.isJsxText(n)) text = n.getText(sf);
      else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text;
      if (text && !/^[a-z0-9-]+$/.test(text.trim())) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        out.push({ at: `${relative(root, file)}:${line + 1}`, text: text.replace(/\s+/g, ' ').trim() });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/**
 * "Raise case", not "equity": the UW Salary Administration Guidelines reserve "equity adjustment" for
 * inequities in categories protected by state and federal law, and the app's own brief says so — so it does
 * not call its parity case an equity review anywhere. The word stays only where it names something else: the
 * guideline's term itself, a job family, and a raise's possible reasons.
 */
describe('the app’s words', () => {
  const all = texts();
  it('are found at all', () => {
    expect(all.length).toBeGreaterThan(1000);
  });
  it('call the parity case a raise case, not equity', () => {
    const allowed = [/equity adjustment/i, /Diversity, Equity and Inclusion/, /Merit, equity, retention/];
    const bad = all.filter((t) => /\bequity\b/i.test(t.text) && !allowed.some((a) => a.test(t.text)));
    expect(bad.map((t) => `${t.at}  ${t.text}`)).toEqual([]);
  });
});
