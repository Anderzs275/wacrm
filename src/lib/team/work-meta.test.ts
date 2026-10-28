import { describe, expect, it } from 'vitest';

import {
  daysUntil,
  parseAmount,
  progressOf,
  toCollabStatus,
  toCollectionStage,
} from './work-meta';

describe('progressOf', () => {
  it('is null with no tasks', () => {
    expect(progressOf([])).toBeNull();
  });

  it('rounds the share of done tasks', () => {
    expect(progressOf([{ done: true }, { done: false }, { done: false }])).toBe(
      33
    );
    expect(progressOf([{ done: true }, { done: true }])).toBe(100);
  });
});

describe('parseAmount', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['1500', 1500],
    ['1,500.50', 1500.5],
    ['S/ 350', 350],
  ])('%j → %j', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it('flags garbage and negatives as NaN', () => {
    expect(parseAmount('mil soles')).toBeNaN();
    expect(parseAmount('-20')).toBeNaN();
  });
});

describe('closed lists', () => {
  it('fall back for unknown values', () => {
    expect(toCollectionStage('samples')).toBe('samples');
    expect(toCollectionStage('nope')).toBe('idea');
    expect(toCollabStatus(undefined)).toBe('prospect');
  });
});

describe('daysUntil', () => {
  it('counts whole days, across months and backwards', () => {
    expect(daysUntil('2026-10-27', '2026-10-27')).toBe(0);
    expect(daysUntil('2026-10-27', '2026-11-06')).toBe(10);
    expect(daysUntil('2026-10-27', '2026-10-20')).toBe(-7);
  });
});
