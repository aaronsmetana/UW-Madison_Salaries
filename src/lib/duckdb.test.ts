import { describe, it, expect } from 'vitest';
import { sqlStr, sqlLikeContains } from './duckdb';

describe('sqlStr', () => {
  it('doubles single quotes so a name like O\'Brien cannot break the literal', () => {
    expect(sqlStr("O'Brien")).toBe("'O''Brien'");
  });
});

describe('sqlLikeContains', () => {
  it('wraps the term so the pattern matches anywhere in the value', () => {
    expect(sqlLikeContains('smith')).toBe("'%smith%'");
  });

  // The bug this exists to prevent: `%` typed into the search box is a LIKE wildcard, so before the
  // escape a single `%` matched every employee in the university and `_` matched any character.
  it('escapes the LIKE wildcards a reader can type', () => {
    expect(sqlLikeContains('100%')).toBe("'%100\\%%'");
    expect(sqlLikeContains('a_b')).toBe("'%a\\_b%'");
  });

  it('escapes the escape character itself, so a backslash matches a backslash', () => {
    expect(sqlLikeContains('a\\b')).toBe("'%a\\\\b%'");
  });

  it('still escapes quotes, since the result is a SQL literal', () => {
    expect(sqlLikeContains("O'Brien")).toBe("'%O''Brien%'");
  });
});
