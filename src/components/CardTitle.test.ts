import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The words of every card title in the app, as written: each `<CardTitle>`'s children, with any `{…}`
 * expression kept as its source text. Read with the TypeScript parser rather than a pattern, because a
 * title's props hold JSX and arrow functions of their own — a regex took a toggle's `=>` for the end of
 * the tag and read its labels as the title.
 */
function cardTitles(): { at: string; text: string; literals: string[] }[] {
  const root = join(__dirname, '..');
  const files = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    .map((f) => join(root, f));
  const out: { at: string; text: string; literals: string[] }[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('<CardTitle')) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === 'CardTitle') {
        const text = node.children
          .map((c) => (ts.isJsxText(c) ? c.getText(sf) : ts.isJsxExpression(c) ? `{${c.expression?.getText(sf) ?? ''}}` : c.getText(sf)))
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        // The strings inside those expressions, which `words` drops with the rest of the expression: a
        // title's words can hide in one ({isTTC ? '(reclassification)' : '(promotions & laterals)'}).
        const literals: string[] = [];
        const collect = (n: ts.Node) => {
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) literals.push(n.text);
          if (ts.isJsxText(n)) literals.push(n.getText(sf));
          // A title's own children, not the props of an element inside it.
          if (!ts.isJsxAttributes(n)) ts.forEachChild(n, collect);
        };
        for (const c of node.children) if (ts.isJsxExpression(c)) collect(c);
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        out.push({ at: `${relative(root, file)}:${line + 1}`, text, literals });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/** A title's own words, without the `{…}` expressions spliced into it (a grade number, a name) — from
 *  the innermost out, since an expression can hold a template's own `${…}`. */
const words = (text: string) => {
  let out = text;
  for (let prev = ''; prev !== out;) { prev = out; out = out.replace(/\{[^{}]*\}/g, ''); }
  return out;
};

/** What a reader can see of a title: its own words, and each string an expression in it can put there. */
const shown = (t: { text: string; literals: string[] }) => [words(t.text), ...t.literals].join(' ');

/**
 * One convention for every card title: a short noun phrase in sentence case, "vs." with its stop. The
 * app had four — sentences ("How this person compares to others with the same title"), em-dash tails
 * ("Pay vs. tenure — same title", "Pay band — grade 27 · official HR range"), parentheticals ("Tenure
 * vs pay (compression check)") and plain
 * phrases — so cards a scroll apart read as if different people had labelled them. What a tail or a
 * parenthetical said belongs in the card's `sub` line, which exists for exactly that.
 */
describe('card titles', () => {
  const titles = cardTitles();

  it('are found at all', () => {
    expect(titles.length).toBeGreaterThan(50);
  });

  it('carry no em-dash tail', () => {
    expect(titles.filter((t) => /\s[—–]\s/.test(shown(t))).map((t) => `${t.at}  ${t.text}`)).toEqual([]);
  });

  it('carry no middle-dot tail', () => {
    expect(titles.filter((t) => /\s·\s/.test(shown(t))).map((t) => `${t.at}  ${t.text}`)).toEqual([]);
  });

  it('carry no parenthetical', () => {
    expect(titles.filter((t) => /[()]/.test(shown(t))).map((t) => `${t.at}  ${t.text}`)).toEqual([]);
  });

  it('write "vs." with its stop', () => {
    expect(titles.filter((t) => /\bvs\b(?!\.)/.test(words(t.text))).map((t) => `${t.at}  ${t.text}`)).toEqual([]);
  });
});
