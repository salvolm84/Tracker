import { describe, it, expect } from 'vitest'
import {
  escapeCsvCell,
  uniqueTrimmedLines,
  serializeStringLines,
  serializeReminderCadenceLines,
  parseReminderCadenceLines,
  extractMentions,
  isConcurrencyConflictMessage,
} from '../utils'

// ── escapeCsvCell ─────────────────────────────────────────────────────────────
describe('escapeCsvCell', () => {
  it('returns plain value unchanged', () => {
    expect(escapeCsvCell('hello')).toBe('hello')
    expect(escapeCsvCell('123')).toBe('123')
  })

  it('wraps in quotes when value contains a comma', () => {
    expect(escapeCsvCell('hello, world')).toBe('"hello, world"')
  })

  it('wraps in quotes and escapes inner quotes', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('wraps in quotes when value contains a newline', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('handles empty string', () => {
    expect(escapeCsvCell('')).toBe('')
  })

  it('handles value with all three special characters', () => {
    const result = escapeCsvCell('a,"b"\nc')
    expect(result).toBe('"a,""b""\nc"')
  })
})

// ── uniqueTrimmedLines ────────────────────────────────────────────────────────
describe('uniqueTrimmedLines', () => {
  it('returns empty array for empty string', () => {
    expect(uniqueTrimmedLines('')).toEqual([])
  })

  it('trims each line', () => {
    expect(uniqueTrimmedLines('  hello  \n  world  ')).toEqual(['hello', 'world'])
  })

  it('filters out blank lines', () => {
    expect(uniqueTrimmedLines('a\n\n\nb')).toEqual(['a', 'b'])
  })

  it('deduplicates identical lines', () => {
    expect(uniqueTrimmedLines('a\nb\na\nc')).toEqual(['a', 'b', 'c'])
  })

  it('preserves order of first occurrence', () => {
    expect(uniqueTrimmedLines('z\na\nz\nb')).toEqual(['z', 'a', 'b'])
  })
})

// ── serializeStringLines ──────────────────────────────────────────────────────
describe('serializeStringLines', () => {
  it('joins array with newlines', () => {
    expect(serializeStringLines(['a', 'b', 'c'])).toBe('a\nb\nc')
  })

  it('returns empty string for empty array', () => {
    expect(serializeStringLines([])).toBe('')
  })

  it('handles single item', () => {
    expect(serializeStringLines(['only'])).toBe('only')
  })
})

// ── serializeReminderCadenceLines ─────────────────────────────────────────────
describe('serializeReminderCadenceLines', () => {
  it('formats entries as "Label | Days"', () => {
    const options = [
      { label: 'Weekly', intervalDays: 7 },
      { label: 'Monthly', intervalDays: 30 },
    ]
    expect(serializeReminderCadenceLines(options)).toBe('Weekly | 7\nMonthly | 30')
  })

  it('handles empty array', () => {
    expect(serializeReminderCadenceLines([])).toBe('')
  })

  it('handles None cadence with 0 days', () => {
    expect(serializeReminderCadenceLines([{ label: 'None', intervalDays: 0 }])).toBe('None | 0')
  })
})

// ── parseReminderCadenceLines ─────────────────────────────────────────────────
describe('parseReminderCadenceLines', () => {
  it('parses valid "Label | Days" lines', () => {
    const result = parseReminderCadenceLines('Weekly | 7\nMonthly | 30')
    expect(result).toEqual([
      { label: 'Weekly', intervalDays: 7 },
      { label: 'Monthly', intervalDays: 30 },
    ])
  })

  it('returns NaN intervalDays for unparseable days', () => {
    const result = parseReminderCadenceLines('Bad | abc')
    expect(result[0].intervalDays).toBeNaN()
  })

  it('ignores blank lines', () => {
    const result = parseReminderCadenceLines('Weekly | 7\n\nMonthly | 30')
    expect(result).toHaveLength(2)
  })

  it('round-trips through serialize/parse', () => {
    const original = [
      { label: 'None', intervalDays: 0 },
      { label: 'Weekly', intervalDays: 7 },
      { label: 'Biweekly', intervalDays: 14 },
    ]
    const serialized = serializeReminderCadenceLines(original)
    const parsed = parseReminderCadenceLines(serialized)
    expect(parsed).toEqual(original)
  })
})

// ── extractMentions ───────────────────────────────────────────────────────────
describe('extractMentions', () => {
  it('returns empty array for no mentions', () => {
    expect(extractMentions('hello world')).toEqual([])
  })

  it('extracts @mentions', () => {
    expect(extractMentions('hey @alice and @bob')).toEqual(['@alice', '@bob'])
  })

  it('deduplicates repeated mentions', () => {
    expect(extractMentions('@alice and @alice again')).toEqual(['@alice'])
  })

  it('handles mentions with dots and underscores', () => {
    expect(extractMentions('@alice.smith @bob_jones')).toEqual(['@alice.smith', '@bob_jones'])
  })

  it('handles empty string', () => {
    expect(extractMentions('')).toEqual([])
  })
})

// ── isConcurrencyConflictMessage ──────────────────────────────────────────────
describe('isConcurrencyConflictMessage', () => {
  it('returns true for messages containing "concurrency conflict"', () => {
    expect(isConcurrencyConflictMessage('Concurrency conflict: record was modified')).toBe(true)
    expect(isConcurrencyConflictMessage('concurrency conflict detected')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isConcurrencyConflictMessage('CONCURRENCY CONFLICT')).toBe(true)
  })

  it('returns false for unrelated messages', () => {
    expect(isConcurrencyConflictMessage('Record not found')).toBe(false)
    expect(isConcurrencyConflictMessage('')).toBe(false)
  })
})
