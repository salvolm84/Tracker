import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  durationDays,
  sortedComments,
  recordConcurrencyToken,
  countValues,
  countSingleValues,
  buildMonthlyBuckets,
  buildAverageDurationBuckets,
  buildHeatmap,
  matchesSharedFilters,
  normalizeSingleValue,
  normalizeListValue,
  normalizeFilters,
  activityStatusColor,
  recordSignalState,
  signalBadges,
  normalizeCategoryImpactFactors,
  parseCategoryImpactFactor,
  categoriesImpactFactor,
} from '../utils'
import type { ActivityRecord, StatsFilters, TrackerSettings } from '../types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: 'test-record-id',
    submittedAt: '2024-01-15T10:00:00Z',
    title: 'Test record',
    owner: 'Alice',
    projects: ['Project A'],
    startDate: '2024-01-01',
    endDate: '2024-01-10',
    departments: ['Engineering'],
    description: 'A test description',
    effort: 'Mid',
    impact: 'High',
    priority: 'High',
    status: 'Open',
    reminderCadence: 'Weekly',
    categories: ['Automation'],
    attachments: [],
    comments: [],
    history: [],
    lastModifiedAt: '2024-01-15T10:00:00Z',
    labActivity: false,
    hwDevelopment: false,
    swDevelopment: false,
    ...overrides,
  }
}

const emptyFilters: StatsFilters = {
  searchTerm: '',
  owners: [],
  departments: [],
  categories: [],
  projects: [],
  priorities: [],
  statuses: [],
  efforts: [],
  impacts: [],
  hwDevelopment: false,
  swDevelopment: false,
  labActivity: false,
}

// ── durationDays ──────────────────────────────────────────────────────────────
describe('durationDays', () => {
  it('counts inclusive days (start to end)', () => {
    const record = makeRecord({ startDate: '2024-01-01', endDate: '2024-01-10' })
    expect(durationDays(record)).toBe(10)
  })

  it('returns 1 for same start and end date', () => {
    const record = makeRecord({ startDate: '2024-06-15', endDate: '2024-06-15' })
    expect(durationDays(record)).toBe(1)
  })

  it('returns 1 (not negative) for inverted dates', () => {
    const record = makeRecord({ startDate: '2024-01-10', endDate: '2024-01-01' })
    expect(durationDays(record)).toBe(1)
  })

  it('counts open records through today when end date is empty', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    const record = makeRecord({ startDate: '2024-01-10', endDate: '' })
    expect(durationDays(record)).toBe(6)
    vi.useRealTimers()
  })
})

// ── sortedComments ────────────────────────────────────────────────────────────
describe('sortedComments', () => {
  it('sorts most recent comment first', () => {
    const comments = [
      { id: 'a', createdAt: '2024-01-01T00:00:00Z', message: 'first', attachments: [] },
      { id: 'b', createdAt: '2024-03-01T00:00:00Z', message: 'third', attachments: [] },
      { id: 'c', createdAt: '2024-02-01T00:00:00Z', message: 'second', attachments: [] },
    ]
    const sorted = sortedComments(comments)
    expect(sorted.map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the original array', () => {
    const comments = [
      { id: 'a', createdAt: '2024-01-01T00:00:00Z', message: 'a', attachments: [] },
      { id: 'b', createdAt: '2024-02-01T00:00:00Z', message: 'b', attachments: [] },
    ]
    const copy = [...comments]
    sortedComments(comments)
    expect(comments).toEqual(copy)
  })
})

// ── recordConcurrencyToken ────────────────────────────────────────────────────
describe('recordConcurrencyToken', () => {
  it('returns lastModifiedAt when set', () => {
    const record = makeRecord({
      lastModifiedAt: '2024-02-01T00:00:00Z',
      submittedAt: '2024-01-01T00:00:00Z',
    })
    expect(recordConcurrencyToken(record)).toBe('2024-02-01T00:00:00Z')
  })

  it('falls back to submittedAt when lastModifiedAt is empty', () => {
    const record = makeRecord({ lastModifiedAt: '', submittedAt: '2024-01-01T00:00:00Z' })
    expect(recordConcurrencyToken(record)).toBe('2024-01-01T00:00:00Z')
  })
})

// ── countValues ───────────────────────────────────────────────────────────────
describe('countValues', () => {
  it('counts occurrences of values', () => {
    const records = [
      makeRecord({ projects: ['A', 'B'] }),
      makeRecord({ projects: ['A'] }),
      makeRecord({ projects: ['C'] }),
    ]
    const result = countValues(records, (r) => r.projects, 10)
    expect(result.find((b) => b.label === 'A')?.value).toBe(2)
    expect(result.find((b) => b.label === 'B')?.value).toBe(1)
    expect(result.find((b) => b.label === 'C')?.value).toBe(1)
  })

  it('returns results sorted by count descending', () => {
    const records = [
      makeRecord({ categories: ['X'] }),
      makeRecord({ categories: ['Y'] }),
      makeRecord({ categories: ['Y'] }),
    ]
    const result = countValues(records, (r) => r.categories, 10)
    expect(result[0].label).toBe('Y')
    expect(result[0].value).toBe(2)
  })

  it('respects the limit', () => {
    const records = [
      makeRecord({ categories: ['A'] }),
      makeRecord({ categories: ['B'] }),
      makeRecord({ categories: ['C'] }),
    ]
    const result = countValues(records, (r) => r.categories, 2)
    expect(result).toHaveLength(2)
  })
})

// ── countSingleValues ─────────────────────────────────────────────────────────
describe('countSingleValues', () => {
  it('counts owner occurrences', () => {
    const records = [
      makeRecord({ owner: 'Alice' }),
      makeRecord({ owner: 'Alice' }),
      makeRecord({ owner: 'Bob' }),
    ]
    const result = countSingleValues(records, (r) => r.owner, 10)
    expect(result[0]).toEqual({ label: 'Alice', value: 2 })
    expect(result[1]).toEqual({ label: 'Bob', value: 1 })
  })
})

// ── buildMonthlyBuckets ───────────────────────────────────────────────────────
describe('buildMonthlyBuckets', () => {
  it('groups records by month', () => {
    const records = [
      makeRecord({ submittedAt: '2024-01-10T00:00:00Z' }),
      makeRecord({ submittedAt: '2024-01-20T00:00:00Z' }),
      makeRecord({ submittedAt: '2024-02-05T00:00:00Z' }),
    ]
    const buckets = buildMonthlyBuckets(records)
    expect(buckets.find((b) => b.label === 'Jan 2024')?.value).toBe(2)
    expect(buckets.find((b) => b.label === 'Feb 2024')?.value).toBe(1)
  })

  it('sorts buckets chronologically', () => {
    const records = [
      makeRecord({ submittedAt: '2024-03-01T00:00:00Z' }),
      makeRecord({ submittedAt: '2024-01-01T00:00:00Z' }),
    ]
    const buckets = buildMonthlyBuckets(records)
    expect(buckets[0].label).toBe('Jan 2024')
    expect(buckets[1].label).toBe('Mar 2024')
  })

  it('returns empty array for empty records', () => {
    expect(buildMonthlyBuckets([])).toEqual([])
  })
})

// ── buildAverageDurationBuckets ───────────────────────────────────────────────
describe('buildAverageDurationBuckets', () => {
  it('computes average duration per owner', () => {
    const records = [
      makeRecord({ owner: 'Alice', startDate: '2024-01-01', endDate: '2024-01-10' }), // 10 days
      makeRecord({ owner: 'Alice', startDate: '2024-01-01', endDate: '2024-01-20' }), // 20 days
      makeRecord({ owner: 'Bob', startDate: '2024-01-01', endDate: '2024-01-05' }),   // 5 days
    ]
    const buckets = buildAverageDurationBuckets(records, 10)
    const alice = buckets.find((b) => b.label === 'Alice')!
    const bob = buckets.find((b) => b.label === 'Bob')!
    expect(alice.value).toBe(15) // (10+20)/2
    expect(bob.value).toBe(5)
  })

  it('includes record count in note', () => {
    const records = [makeRecord({ owner: 'Alice' })]
    const buckets = buildAverageDurationBuckets(records, 10)
    expect(buckets[0].note).toBe('1 record')
  })

  it('shows plural for multiple records', () => {
    const records = [makeRecord({ owner: 'Alice' }), makeRecord({ owner: 'Alice' })]
    const buckets = buildAverageDurationBuckets(records, 10)
    expect(buckets[0].note).toBe('2 records')
  })
})

// ── buildHeatmap ──────────────────────────────────────────────────────────────
describe('buildHeatmap', () => {
  it('creates cells for every effort x impact combination', () => {
    const efforts = ['Low', 'High']
    const impacts = ['Low', 'High']
    const cells = buildHeatmap([], efforts, impacts)
    expect(cells).toHaveLength(4)
    expect(cells.map((c) => `${c.effort}:${c.impact}`)).toEqual([
      'Low:Low', 'Low:High', 'High:Low', 'High:High',
    ])
  })

  it('counts records in correct cells', () => {
    const records = [
      makeRecord({ effort: 'Low', impact: 'High' }),
      makeRecord({ effort: 'Low', impact: 'High' }),
      makeRecord({ effort: 'High', impact: 'Low' }),
    ]
    const cells = buildHeatmap(records, ['Low', 'High'], ['Low', 'High'])
    expect(cells.find((c) => c.effort === 'Low' && c.impact === 'High')?.value).toBe(2)
    expect(cells.find((c) => c.effort === 'High' && c.impact === 'Low')?.value).toBe(1)
    expect(cells.find((c) => c.effort === 'Low' && c.impact === 'Low')?.value).toBe(0)
  })
})

// ── matchesSharedFilters ──────────────────────────────────────────────────────
describe('matchesSharedFilters', () => {
  it('matches all records when filters are empty', () => {
    expect(matchesSharedFilters(makeRecord(), emptyFilters)).toBe(true)
  })

  it('filters by owner', () => {
    const record = makeRecord({ owner: 'Alice' })
    expect(matchesSharedFilters(record, { ...emptyFilters, owners: ['Alice'] })).toBe(true)
    expect(matchesSharedFilters(record, { ...emptyFilters, owners: ['Bob'] })).toBe(false)
  })

  it('filters by status', () => {
    const record = makeRecord({ status: 'Open' })
    expect(matchesSharedFilters(record, { ...emptyFilters, statuses: ['Open'] })).toBe(true)
    expect(matchesSharedFilters(record, { ...emptyFilters, statuses: ['Completed'] })).toBe(false)
  })

  it('filters by priority', () => {
    const record = makeRecord({ priority: 'High' })
    expect(matchesSharedFilters(record, { ...emptyFilters, priorities: ['High'] })).toBe(true)
    expect(matchesSharedFilters(record, { ...emptyFilters, priorities: ['Low'] })).toBe(false)
  })

  it('filters by project (any-match)', () => {
    const record = makeRecord({ projects: ['Alpha', 'Beta'] })
    expect(matchesSharedFilters(record, { ...emptyFilters, projects: ['Beta'] })).toBe(true)
    expect(matchesSharedFilters(record, { ...emptyFilters, projects: ['Gamma'] })).toBe(false)
  })

  it('filters by department (any-match)', () => {
    const record = makeRecord({ departments: ['Engineering', 'Finance'] })
    expect(matchesSharedFilters(record, { ...emptyFilters, departments: ['Finance'] })).toBe(true)
    expect(matchesSharedFilters(record, { ...emptyFilters, departments: ['HR'] })).toBe(false)
  })

  it('searches title case-insensitively', () => {
    const record = makeRecord({ title: 'Quarterly Report Automation' })
    expect(matchesSharedFilters(record, { ...emptyFilters, searchTerm: 'quarterly' })).toBe(true)
    expect(matchesSharedFilters(record, { ...emptyFilters, searchTerm: 'AUTOMATION' })).toBe(true)
    expect(matchesSharedFilters(record, { ...emptyFilters, searchTerm: 'budget' })).toBe(false)
  })

  it('searches description', () => {
    const record = makeRecord({ description: 'This covers the Q4 targets' })
    expect(matchesSharedFilters(record, { ...emptyFilters, searchTerm: 'q4 targets' })).toBe(true)
  })

  it('applies multiple filters conjunctively (AND)', () => {
    const record = makeRecord({ owner: 'Alice', priority: 'High' })
    const filters = { ...emptyFilters, owners: ['Alice'], priorities: ['Low'] }
    expect(matchesSharedFilters(record, filters)).toBe(false)
  })
})

// ── normalizeSingleValue ──────────────────────────────────────────────────────
describe('normalizeSingleValue', () => {
  it('returns the value when it is in the allowed list', () => {
    expect(normalizeSingleValue('Mid', ['Low', 'Mid', 'High'])).toBe('Mid')
  })

  it('returns the first allowed value when input is not in list', () => {
    expect(normalizeSingleValue('Unknown', ['Low', 'Mid', 'High'])).toBe('Low')
  })

  it('returns the first allowed value for null input', () => {
    expect(normalizeSingleValue(null, ['Low', 'Mid'])).toBe('Low')
  })

  it('returns null when allowed list is empty', () => {
    expect(normalizeSingleValue('anything', [])).toBeNull()
  })
})

// ── normalizeListValue ────────────────────────────────────────────────────────
describe('normalizeListValue', () => {
  it('keeps values that are in the allowed list', () => {
    expect(normalizeListValue(['Low', 'High'], ['Low', 'Mid', 'High'])).toEqual(['Low', 'High'])
  })

  it('removes values not in the allowed list', () => {
    expect(normalizeListValue(['Low', 'Unknown', 'High'], ['Low', 'High'])).toEqual(['Low', 'High'])
  })

  it('deduplicates values', () => {
    expect(normalizeListValue(['Low', 'Low', 'High'], ['Low', 'High'])).toEqual(['Low', 'High'])
  })

  it('returns empty array for empty input', () => {
    expect(normalizeListValue([], ['Low', 'High'])).toEqual([])
  })
})

// ── normalizeFilters ──────────────────────────────────────────────────────────
describe('normalizeFilters', () => {
  const settings: TrackerSettings = {
    owners: ['Alice', 'Bob'],
    projects: ['Alpha'],
    departments: ['Engineering'],
    categories: ['Automation'],
    categoryImpactFactors: {},
    priorities: ['Low', 'Mid', 'High'],
    efforts: ['Low', 'Mid', 'High'],
    impacts: ['Low', 'Mid', 'High'],
    statuses: ['Open', 'Completed'],
    reminderCadences: [{ label: 'None', intervalDays: 0 }],
  }

  it('removes owner filters no longer in settings', () => {
    const filters = { ...emptyFilters, owners: ['Alice', 'Charlie'] }
    const normalized = normalizeFilters(filters, settings)
    expect(normalized.owners).toEqual(['Alice'])
  })

  it('removes status filters no longer in settings', () => {
    const filters = { ...emptyFilters, statuses: ['Open', 'Halted'] as any }
    const normalized = normalizeFilters(filters, settings)
    expect(normalized.statuses).toEqual(['Open'])
  })

  it('preserves searchTerm unchanged', () => {
    const filters = { ...emptyFilters, searchTerm: 'quarterly' }
    expect(normalizeFilters(filters, settings).searchTerm).toBe('quarterly')
  })
})

// ── activityStatusColor ───────────────────────────────────────────────────────
describe('activityStatusColor', () => {
  it.each([
    ['scheduled', 'grape'],
    ['open', 'blue'],
    ['on hold', 'yellow'],
    ['halted', 'red'],
    ['completed', 'teal'],
    ['Scheduled', 'grape'],
    ['Open', 'blue'],
    ['Completed', 'teal'],
    ['unknown', 'gray'],
  ])('maps "%s" → "%s"', (status, expected) => {
    expect(activityStatusColor(status)).toBe(expected)
  })
})

// ── normalizeCategoryImpactFactors ────────────────────────────────────────────
describe('normalizeCategoryImpactFactors', () => {
  it('preserves valid factors', () => {
    const result = normalizeCategoryImpactFactors(['A', 'B'], { A: 1.5, B: 0.5 })
    expect(result).toEqual({ A: 1.5, B: 0.5 })
  })

  it('defaults to 1 for missing factors', () => {
    const result = normalizeCategoryImpactFactors(['A', 'B'], { A: 1.5 })
    expect(result.B).toBe(1)
  })

  it('clamps to maximum of 2', () => {
    const result = normalizeCategoryImpactFactors(['A'], { A: 5 })
    expect(result.A).toBe(2)
  })

  it('clamps to minimum of 0', () => {
    const result = normalizeCategoryImpactFactors(['A'], { A: -1 })
    expect(result.A).toBe(0)
  })

  it('replaces non-finite values with 1', () => {
    const result = normalizeCategoryImpactFactors(['A'], { A: NaN })
    expect(result.A).toBe(1)
  })

  it('only includes specified categories', () => {
    const result = normalizeCategoryImpactFactors(['A'], { A: 1, B: 2 })
    expect(result).not.toHaveProperty('B')
  })
})

// ── parseCategoryImpactFactor ─────────────────────────────────────────────────
describe('parseCategoryImpactFactor', () => {
  it('parses valid numbers in [0, 2]', () => {
    expect(parseCategoryImpactFactor('0')).toBe(0)
    expect(parseCategoryImpactFactor('1')).toBe(1)
    expect(parseCategoryImpactFactor('1.5')).toBe(1.5)
    expect(parseCategoryImpactFactor('2')).toBe(2)
  })

  it('returns null for out-of-range values', () => {
    expect(parseCategoryImpactFactor('-0.1')).toBeNull()
    expect(parseCategoryImpactFactor('2.1')).toBeNull()
  })

  it('returns null for non-numeric strings', () => {
    expect(parseCategoryImpactFactor('abc')).toBeNull()
  })

  it('returns 0 for empty string (Number("") === 0)', () => {
    expect(parseCategoryImpactFactor('')).toBe(0)
  })
})

// ── categoriesImpactFactor ────────────────────────────────────────────────────
describe('categoriesImpactFactor', () => {
  it('returns the maximum factor among selected categories', () => {
    expect(categoriesImpactFactor(['A', 'B'], { A: 1.5, B: 0.5 })).toBe(1.5)
  })

  it('defaults missing categories to 1', () => {
    expect(categoriesImpactFactor(['X'], {})).toBe(1)
  })

  it('returns 1 for empty categories list', () => {
    expect(categoriesImpactFactor([], {})).toBe(1)
  })
})

// ── recordSignalState ─────────────────────────────────────────────────────────
describe('recordSignalState', () => {
  const fixedNow = '2024-06-15T12:00:00Z'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(fixedNow))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks record as overdue when endDate is in the past and not completed', () => {
    const record = makeRecord({
      endDate: '2024-06-10',
      status: 'Open',
      lastModifiedAt: '2024-06-14T00:00:00Z',
    })
    const state = recordSignalState(record)
    expect(state.overdue).toBe(true)
  })

  it('does not mark completed records as overdue', () => {
    const record = makeRecord({ endDate: '2024-06-10', status: 'Completed' })
    const state = recordSignalState(record)
    expect(state.overdue).toBe(false)
  })

  it('marks record as stale when last activity > 14 days ago', () => {
    const record = makeRecord({
      status: 'Open',
      endDate: '2024-12-31',
      lastModifiedAt: '2024-05-01T00:00:00Z',
      submittedAt: '2024-05-01T00:00:00Z',
    })
    const state = recordSignalState(record)
    expect(state.stale).toBe(true)
  })

  it('marks dueSoon when end date is within 7 days', () => {
    const record = makeRecord({
      status: 'Open',
      endDate: '2024-06-20',
      lastModifiedAt: '2024-06-15T00:00:00Z',
    })
    const state = recordSignalState(record)
    expect(state.dueSoon).toBe(true)
    expect(state.overdue).toBe(false)
  })

  it('does not mark open-ended records as overdue or due soon', () => {
    const record = makeRecord({
      status: 'Open',
      endDate: '',
      lastModifiedAt: '2024-06-15T00:00:00Z',
    })
    const state = recordSignalState(record)
    expect(state.overdue).toBe(false)
    expect(state.dueSoon).toBe(false)
  })
})

// ── signalBadges ──────────────────────────────────────────────────────────────
describe('signalBadges', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('returns empty array for healthy record', () => {
    const record = makeRecord({
      status: 'Open',
      endDate: '2024-12-31',
      reminderCadence: 'None',
      lastModifiedAt: '2024-06-15T00:00:00Z',
    })
    expect(signalBadges(record)).toEqual([])
  })

  it('includes Overdue badge for past-due open record', () => {
    const record = makeRecord({ endDate: '2024-06-01', status: 'Open' })
    const badges = signalBadges(record)
    expect(badges.some((b) => b.label === 'Overdue')).toBe(true)
  })
})
