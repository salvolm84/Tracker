import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type {
  ActivityRecord,
  ActivityStatus,
  BootstrapPayload,
  DatabaseDocument,
  RecordComment,
  StatsFilters,
  TrackerSettings,
} from './types'

dayjs.extend(isoWeek)

// ── Date helpers ──────────────────────────────────────────────────────────────

export function isoWeeksInYear(year: number) {
  return dayjs(`${year}-12-28`).isoWeek()
}

export function formatDate(date: Date | null) {
  return date ? dayjs(date).format('YYYY-MM-DD') : null
}

export function formatTimestamp(value: string | null) {
  return value ? dayjs(value).format('DD MMM YYYY, HH:mm') : 'No data yet'
}

export function formatShortDate(value: string | null) {
  return value ? dayjs(value).format('DD MMM YYYY') : 'No data yet'
}

export function formatCommentDate(value: string) {
  return dayjs(value).format('ddd DD MMM')
}

export function formatDateRange(startDate: string, endDate: string) {
  const formattedStart = dayjs(startDate).format('DD MMM YYYY')
  const formattedEnd = endDate ? dayjs(endDate).format('DD MMM YYYY') : 'Open'
  return `${formattedStart} - ${formattedEnd}`
}

export function formatWeeklyRange(year: number, week: number) {
  const start = dayjs(`${year}-01-04`).isoWeek(week).startOf('isoWeek')
  const end = start.endOf('isoWeek')
  return `${start.format('DD MMM YYYY')} - ${end.format('DD MMM YYYY')}`
}

// ── Size / number helpers ─────────────────────────────────────────────────────

export function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatMetricNumber(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

// ── Impact factor ─────────────────────────────────────────────────────────────

export function formatImpactFactor(value: number) {
  if (!Number.isFinite(value)) return '1'
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function normalizeCategoryImpactFactors(
  categories: string[],
  factors: Record<string, number>,
) {
  const normalized: Record<string, number> = {}
  for (const category of categories) {
    const factor = factors[category]
    normalized[category] = Number.isFinite(factor) ? Math.min(2, Math.max(0, factor)) : 1
  }
  return normalized
}

export function parseCategoryImpactFactor(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : null
}

export function categoriesImpactFactor(categories: string[], factors: Record<string, number>) {
  const selected = categories.map((c) => factors[c] ?? 1)
  return selected.length === 0 ? 1 : Math.max(...selected)
}

export function recordCategoryImpactFactor(record: ActivityRecord, factors: Record<string, number>) {
  return categoriesImpactFactor(record.categories, factors)
}

// ── String / serialization helpers ────────────────────────────────────────────

export function escapeCsvCell(value: string): string {
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function uniqueTrimmedLines(value: string) {
  return Array.from(
    new Set(
      value
        .split('\n')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  )
}

export function serializeStringLines(values: string[]) {
  return values.join('\n')
}

export function formatRecordKey(recordId: string) {
  return `TRK-${recordId.slice(0, 6).toUpperCase()}`
}

export function formatWeeklyCommentBullet(message: string) {
  return message
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => `${index === 0 ? '' : '    '}${line}`)
    .join('\n')
}

export function extractMentions(message: string) {
  return Array.from(new Set(message.match(/@[A-Za-z0-9._-]+/g) ?? []))
}

export function isConcurrencyConflictMessage(message: string) {
  return message.toLowerCase().includes('concurrency conflict')
}

// ── Filter / normalize helpers ────────────────────────────────────────────────

export function normalizeSingleValue(value: string | null, allowed: string[]) {
  return value && allowed.includes(value) ? value : (allowed[0] ?? null)
}

export function normalizeListValue(values: string[], allowed: string[]) {
  return values.filter(
    (value, index, source) => allowed.includes(value) && source.indexOf(value) === index,
  )
}

export function normalizeFilters(filters: StatsFilters, settings: TrackerSettings): StatsFilters {
  return {
    ...filters,
    owners: normalizeListValue(filters.owners, settings.owners),
    departments: normalizeListValue(filters.departments, settings.departments),
    categories: normalizeListValue(filters.categories, settings.categories),
    projects: normalizeListValue(filters.projects, settings.projects),
    priorities: normalizeListValue(filters.priorities, settings.priorities),
    statuses: normalizeListValue(filters.statuses, settings.statuses) as ActivityStatus[],
    efforts: normalizeListValue(filters.efforts, settings.efforts),
    impacts: normalizeListValue(filters.impacts, settings.impacts),
  }
}

export function matchesSharedFilters(record: ActivityRecord, filters: StatsFilters) {
  const searchTerm = filters.searchTerm.trim().toLowerCase()
  const searchMatch =
    searchTerm.length === 0 ||
    [record.title, record.description, record.owner, record.status, record.priority, record.effort, record.impact]
      .some((v) => v.toLowerCase().includes(searchTerm)) ||
    record.projects.some((p) => p.toLowerCase().includes(searchTerm)) ||
    record.departments.some((d) => d.toLowerCase().includes(searchTerm)) ||
    record.categories.some((c) => c.toLowerCase().includes(searchTerm)) ||
    record.comments.some((c) => c.message.toLowerCase().includes(searchTerm)) ||
    (record.todos ?? []).some((todo) => todo.text.toLowerCase().includes(searchTerm) || todo.owner.toLowerCase().includes(searchTerm)) ||
    record.history.some((e) => e.message.toLowerCase().includes(searchTerm))

  return (
    searchMatch &&
    (filters.owners.length === 0 || filters.owners.includes(record.owner)) &&
    (filters.departments.length === 0 || record.departments.some((d) => filters.departments.includes(d))) &&
    (filters.categories.length === 0 || record.categories.some((c) => filters.categories.includes(c))) &&
    (filters.projects.length === 0 || record.projects.some((p) => filters.projects.includes(p))) &&
    (filters.priorities.length === 0 || filters.priorities.includes(record.priority)) &&
    (filters.statuses.length === 0 || filters.statuses.includes(record.status)) &&
    (filters.efforts.length === 0 || filters.efforts.includes(record.effort)) &&
    (filters.impacts.length === 0 || filters.impacts.includes(record.impact)) &&
    (!filters.hwDevelopment || record.hwDevelopment) &&
    (!filters.swDevelopment || record.swDevelopment) &&
    (!filters.labActivity || record.labActivity)
  )
}

// ── Record aggregation ────────────────────────────────────────────────────────

export function durationDays(record: ActivityRecord) {
  const endDate = record.endDate ? dayjs(record.endDate) : dayjs()
  return Math.max(endDate.diff(dayjs(record.startDate), 'day'), 0) + 1
}

export function sortedComments(comments: RecordComment[]) {
  return [...comments].sort(
    (a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf(),
  )
}

export function recordConcurrencyToken(record: ActivityRecord) {
  return record.lastModifiedAt || record.submittedAt
}

export function countValues(
  records: ActivityRecord[],
  selector: (record: ActivityRecord) => string[],
  limit: number,
) {
  const counts = new Map<string, number>()
  for (const record of records) {
    for (const value of selector(record)) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }))
}

export function countSingleValues(
  records: ActivityRecord[],
  selector: (record: ActivityRecord) => string,
  limit: number,
) {
  return countValues(records, (r) => [selector(r)], limit)
}

export function buildMonthlyBuckets(records: ActivityRecord[]) {
  const counts = new Map<string, number>()
  for (const record of records) {
    const label = dayjs(record.submittedAt).format('MMM YYYY')
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => dayjs(a[0], 'MMM YYYY').valueOf() - dayjs(b[0], 'MMM YYYY').valueOf())
    .map(([label, value]) => ({ label, value }))
}

export function buildAverageDurationBuckets(records: ActivityRecord[], limit: number) {
  const totals = new Map<string, { count: number; totalDays: number }>()
  for (const record of records) {
    const entry = totals.get(record.owner) ?? { count: 0, totalDays: 0 }
    entry.count += 1
    entry.totalDays += durationDays(record)
    totals.set(record.owner, entry)
  }
  return Array.from(totals.entries())
    .map(([label, t]) => ({
      label,
      value: Number((t.totalDays / t.count).toFixed(1)),
      note: `${t.count} record${t.count === 1 ? '' : 's'}`,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit)
}

export function buildHeatmap(records: ActivityRecord[], efforts: string[], impacts: string[]) {
  const counts = new Map<string, number>()
  for (const record of records) {
    const key = `${record.effort}:${record.impact}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const cells: { effort: string; impact: string; value: number }[] = []
  for (const effort of efforts) {
    for (const impact of impacts) {
      cells.push({ effort, impact, value: counts.get(`${effort}:${impact}`) ?? 0 })
    }
  }
  return cells
}

export function buildMonthlyOpenActivityBuckets(
  records: ActivityRecord[],
  factors: Record<string, number>,
  weighted = false,
) {
  if (records.length === 0) return []
  const starts = records.map((r) => dayjs(r.startDate))
  const ends = records.map((r) => (r.endDate ? dayjs(r.endDate) : dayjs()))
  const firstMonth = starts.reduce((e, v) => (v.isBefore(e) ? v : e), starts[0]).startOf('month')
  const lastMonth = ends.reduce((l, v) => (v.isAfter(l) ? v : l), ends[0]).startOf('month')
  const buckets: { label: string; value: number }[] = []
  for (
    let cursor = firstMonth;
    cursor.isBefore(lastMonth) || cursor.isSame(lastMonth, 'month');
    cursor = cursor.add(1, 'month')
  ) {
    const monthStart = cursor.startOf('month')
    const monthEnd = cursor.endOf('month')
    const open = records.filter((r) => {
      const s = dayjs(r.startDate).startOf('day')
      const e = r.endDate ? dayjs(r.endDate).endOf('day') : dayjs().endOf('day')
      return !s.isAfter(monthEnd, 'day') && !e.isBefore(monthStart, 'day')
    })
    const value = weighted
      ? open.reduce((sum, r) => sum + recordCategoryImpactFactor(r, factors), 0)
      : open.length
    buckets.push({ label: cursor.format('MMM YYYY'), value: Number(value.toFixed(1)) })
  }
  return buckets
}

// ── Settings helpers ──────────────────────────────────────────────────────────

export function settingsFromBootstrap(bootstrap: BootstrapPayload): TrackerSettings {
  return {
    owners: [...bootstrap.owners],
    projects: [...bootstrap.projects],
    departments: [...bootstrap.departments],
    categories: [...bootstrap.categories],
    categoryImpactFactors: normalizeCategoryImpactFactors(
      bootstrap.categories,
      bootstrap.categoryImpactFactors,
    ),
    priorities: [...bootstrap.priorities],
    efforts: [...bootstrap.efforts],
    impacts: [...bootstrap.impacts],
    statuses: [...bootstrap.statuses],
    reminderCadences: bootstrap.reminderCadences.map((entry) => ({ ...entry })),
  }
}

export function buildDatabaseDocument(
  settings: TrackerSettings,
  records: ActivityRecord[],
): DatabaseDocument {
  return {
    settings: {
      owners: [...settings.owners],
      projects: [...settings.projects],
      departments: [...settings.departments],
      categories: [...settings.categories],
      categoryImpactFactors: normalizeCategoryImpactFactors(
        settings.categories,
        settings.categoryImpactFactors,
      ),
      priorities: [...settings.priorities],
      efforts: [...settings.efforts],
      impacts: [...settings.impacts],
      statuses: [...settings.statuses],
      reminderCadences: settings.reminderCadences.map((entry) => ({ ...entry })),
    },
    records,
  }
}

// ── Signal / status helpers ───────────────────────────────────────────────────

export function activityStatusColor(status: ActivityStatus) {
  switch (status.toLowerCase()) {
    case 'scheduled': return 'grape'
    case 'open': return 'blue'
    case 'on hold': return 'yellow'
    case 'halted': return 'red'
    case 'completed': return 'teal'
    default: return 'gray'
  }
}

export function recordTimelineMoments(record: ActivityRecord) {
  return [
    dayjs(record.lastModifiedAt || record.submittedAt),
    dayjs(record.submittedAt),
    ...record.comments.map((c) => dayjs(c.createdAt)),
    ...record.history.map((e) => dayjs(e.createdAt)),
  ]
}

export function latestRecordMoment(record: ActivityRecord) {
  return recordTimelineMoments(record).sort((a, b) => b.valueOf() - a.valueOf())[0]
}

export function recordSignalState(record: ActivityRecord) {
  const today = dayjs().endOf('day')
  const endDate = record.endDate ? dayjs(record.endDate) : null
  const latestMoment = latestRecordMoment(record)
  const isCompleted = record.status.toLowerCase() === 'completed'

  return {
    overdue: !isCompleted && endDate !== null && endDate.isBefore(today, 'day'),
    dueSoon:
      !isCompleted &&
      endDate !== null &&
      !endDate.isBefore(today, 'day') &&
      endDate.diff(dayjs().startOf('day'), 'day') <= 7,
    stale: !isCompleted && dayjs().diff(latestMoment, 'day') >= 14,
    latestMoment,
  }
}

export function signalBadges(record: ActivityRecord) {
  const signals = recordSignalState(record)
  const badges: Array<{ label: string; color: string }> = []
  if (signals.overdue) badges.push({ label: 'Overdue', color: 'red' })
  else if (signals.dueSoon) badges.push({ label: 'Due soon', color: 'yellow' })
  if (signals.stale) badges.push({ label: 'Stale', color: 'orange' })
  return badges
}
