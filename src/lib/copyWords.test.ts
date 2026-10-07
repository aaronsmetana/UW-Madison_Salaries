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
      // JSX text is always read. A string may be a key: one lower-case word, with no space around it — so
      // " percentile" after a substitution is text.
      if (ts.isJsxText(n)) text = n.getText(sf).trim() || null;
      else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
        text = /^[a-z0-9-]+$/.test(n.text) ? null : n.text;
      }
      if (text) {
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
  // Standing in one voice (PercentileNote): on screen a person is "paid more than 61%" of a pool and a pay level
  // has "61% paid less" — the same number, the share paid less, in words that need no glossary. "The 61st
  // percentile" is the printed brief's register, which has a glossary and a footnote to carry it. A ranked
  // label ("25th percentile $72k") names a quantile, not a standing, and is not caught: its ordinal is literal.
  it('state a standing on screen as a share paid less, and a percentile only in print', () => {
    const print = ['components/report/ReportBrief.tsx', 'lib/wordExport.ts', 'lib/stats.ts'];
    const bad = all.filter((t) => /^(percentile|pctile)\b/i.test(t.text) && !print.some((f) => t.at.startsWith(f)));
    expect(bad.map((t) => `${t.at}  ${t.text}`)).toEqual([]);
  });
  it('place a pay in its grade’s band in one phrase', () => {
    expect(all.filter((t) => /\bthrough band\b|\bof range\b/i.test(t.text)).map((t) => `${t.at}  ${t.text}`)).toEqual([]);
    expect(all.some((t) => /% through the band\b/.test(t.text))).toBe(true);
  });
});
