import { startTransition, useEffect, useEffectEvent, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  InputLabel,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  Progress,
  Select,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { DateInput } from '@mantine/dates'
import { useForm } from '@mantine/form'
import {
  IconAlertCircle,
  IconChartBar,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconCircleCheck,
  IconClipboardText,
  IconDatabase,
  IconEdit,
  IconFileDescription,
  IconHelp,
  IconPaperclip,
  IconFolders,
  IconLayoutDashboard,
  IconLayoutKanban,
  IconListDetails,
  IconMoon,
  IconSun,
  IconTargetArrow,
  IconTrash,
  IconUsersGroup,
  IconX,
} from '@tabler/icons-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import {
  appendActivityComment,
  defaultTrackerSettings,
  deleteActivityComment,
  getActivityRecords,
  bootstrapForm,
  fallbackBootstrap,
  getAttachmentStorageStats,
  getDatabaseStats,
  listDatabaseBackups,
  quickUpdateActivity,
  readAttachmentData,
  readAttachmentsFromPaths,
  relabelTrackerSettings,
  replaceDatabaseRecords,
  restoreDatabaseBackup,
  submitActivity,
  updateActivity,
  updateActivityComment,
  updateTrackerSettings,
} from './api'
import {
  attachmentIcon,
  attachmentPreviewData,
  downloadAttachment,
  fileToAttachment,
  mergeAttachments,
  previewAttachmentKind,
} from './attachments'
import type {
  AttachmentData,
  AttachmentPayload,
  AttachmentStorageStats,
  ActivityRecord,
  ActivityFormValues,
  ActivityStatus,
  BootstrapPayload,
  CountBucket,
  DatabaseBackup,
  DatabaseDocument,
  DatabaseStats,
  QuickUpdatePayload,
  RecordComment,
  RecordHistoryEntry,
  ReminderCadence,
  ReminderCadenceOption,
  StatsFilters,
  TrackerSettings,
} from './types'
import './App.css'

dayjs.extend(isoWeek)

type PageKey = 'overview' | 'form' | 'records' | 'board' | 'insights' | 'weekly' | 'admin'
type WeeklyReportMode = 'week' | 'range'
type WeeklyTemplate = 'bullets' | 'executive' | 'owner' | 'project'
type HeatmapValueMode = 'count' | 'percent'
type SavedView = {
  id: string
  name: string
  filters: StatsFilters
}
type InsightBucket = {
  label: string
  value: number
  note?: string
}
type HeatmapCell = {
  effort: string
  impact: string
  value: number
}
type SettingsFieldKey =
  | 'owners'
  | 'projects'
  | 'departments'
  | 'categories'
  | 'priorities'
  | 'efforts'
  | 'impacts'
  | 'statuses'
  | 'reminderCadences'
type SettingsUsageReference = {
  recordId: string
  title: string
}
type SettingsUsageConflict = {
  field: SettingsFieldKey
  fieldLabel: string
  removedValue: string
  removedDraftLine: string
  replacementOptions: string[]
  usages: SettingsUsageReference[]
  replacement: string | null
}
type RefreshErrorMap = Partial<
  Record<'bootstrap' | 'stats' | 'records' | 'backups' | 'attachments', string>
>

const savedViewsStorageKey = 'tracker.saved-views.v1'

const initialValues: ActivityFormValues = {
  title: '',
  owner: null,
  projects: [],
  startDate: null,
  endDate: null,
  departments: [],
  description: '',
  effort: null,
  impact: null,
  priority: null,
  status: defaultTrackerSettings.statuses[1] ?? defaultTrackerSettings.statuses[0] ?? null,
  reminderCadence: defaultTrackerSettings.reminderCadences[0]?.label ?? null,
  categories: [],
  attachments: [],
}

const fallbackStats: DatabaseStats = {
  recordCount: 0,
  uniqueOwners: 0,
  uniqueProjects: 0,
  uniqueDepartments: 0,
  uniqueCategories: 0,
  averageDurationDays: 0,
  latestSubmittedAt: null,
  upcomingEndDate: null,
  priorityCounts: [],
  effortCounts: [],
  impactCounts: [],
  topOwners: [],
  topProjects: [],
}

const emptySharedFilters: StatsFilters = {
  searchTerm: '',
  owners: [],
  departments: [],
  categories: [],
  projects: [],
  priorities: [],
  statuses: [],
  efforts: [],
  impacts: [],
}

const pageShortcutMap: Record<PageKey, string> = {
  overview: '1',
  form: '2',
  records: '3',
  board: '4',
  insights: '5',
  weekly: '6',
  admin: '7',
}

const orderedPages: PageKey[] = [
  'overview',
  'form',
  'records',
  'board',
  'insights',
  'weekly',
  'admin',
]

function isoWeeksInYear(year: number) {
  return dayjs(`${year}-12-28`).isoWeek()
}

function formatDate(date: Date | null) {
  return date ? dayjs(date).format('YYYY-MM-DD') : null
}

function formatTimestamp(value: string | null) {
  return value ? dayjs(value).format('DD MMM YYYY, HH:mm') : 'No data yet'
}

function formatShortDate(value: string | null) {
  return value ? dayjs(value).format('DD MMM YYYY') : 'No data yet'
}

function formatCommentDate(value: string) {
  return dayjs(value).format('ddd DD MMM')
}

function formatDateRange(startDate: string, endDate: string) {
  return `${dayjs(startDate).format('DD MMM YYYY')} - ${dayjs(endDate).format('DD MMM YYYY')}`
}

function formatWeeklyRange(year: number, week: number) {
  const start = dayjs(`${year}-01-04`).isoWeek(week).startOf('isoWeek')
  const end = start.endOf('isoWeek')
  return `${start.format('DD MMM YYYY')} - ${end.format('DD MMM YYYY')}`
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatMetricNumber(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

function durationDays(record: ActivityRecord) {
  const startDate = dayjs(record.startDate)
  const endDate = dayjs(record.endDate)
  const diff = endDate.diff(startDate, 'day')

  return Math.max(diff, 0) + 1
}

function matchesSharedFilters(record: ActivityRecord, filters: StatsFilters) {
  const searchTerm = filters.searchTerm.trim().toLowerCase()
  const searchMatch =
    searchTerm.length === 0 ||
    [
      record.title,
      record.description,
      record.owner,
      record.status,
      record.priority,
      record.effort,
      record.impact,
    ].some((value) => value.toLowerCase().includes(searchTerm)) ||
    record.projects.some((project) => project.toLowerCase().includes(searchTerm)) ||
    record.departments.some((department) => department.toLowerCase().includes(searchTerm)) ||
    record.categories.some((category) => category.toLowerCase().includes(searchTerm)) ||
    record.comments.some((comment) => comment.message.toLowerCase().includes(searchTerm)) ||
    record.history.some((entry) => entry.message.toLowerCase().includes(searchTerm))
  const ownerMatch =
    filters.owners.length === 0 || filters.owners.includes(record.owner)
  const departmentMatch =
    filters.departments.length === 0 ||
    record.departments.some((department) => filters.departments.includes(department))
  const categoryMatch =
    filters.categories.length === 0 ||
    record.categories.some((category) => filters.categories.includes(category))
  const projectMatch =
    filters.projects.length === 0 ||
    record.projects.some((project) => filters.projects.includes(project))
  const priorityMatch =
    filters.priorities.length === 0 ||
    filters.priorities.includes(record.priority)
  const statusMatch =
    filters.statuses.length === 0 ||
    filters.statuses.includes(record.status)
  const effortMatch =
    filters.efforts.length === 0 ||
    filters.efforts.includes(record.effort)
  const impactMatch =
    filters.impacts.length === 0 ||
    filters.impacts.includes(record.impact)

  return (
    searchMatch &&
    ownerMatch &&
    departmentMatch &&
    categoryMatch &&
    projectMatch &&
    priorityMatch &&
    statusMatch &&
    effortMatch &&
    impactMatch
  )
}

function countValues(
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
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }))
}

function countSingleValues(
  records: ActivityRecord[],
  selector: (record: ActivityRecord) => string,
  limit: number,
) {
  return countValues(records, (record) => [selector(record)], limit)
}

function buildMonthlyBuckets(records: ActivityRecord[]) {
  const counts = new Map<string, number>()

  for (const record of records) {
    const label = dayjs(record.submittedAt).format('MMM YYYY')
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((left, right) =>
      dayjs(left[0], 'MMM YYYY').valueOf() - dayjs(right[0], 'MMM YYYY').valueOf(),
    )
    .map(([label, value]) => ({ label, value }))
}

function buildAverageDurationBuckets(records: ActivityRecord[], limit: number) {
  const totals = new Map<string, { count: number; totalDays: number }>()

  for (const record of records) {
    const entry = totals.get(record.owner) ?? { count: 0, totalDays: 0 }
    entry.count += 1
    entry.totalDays += durationDays(record)
    totals.set(record.owner, entry)
  }

  return Array.from(totals.entries())
    .map(([label, totalsByOwner]) => ({
      label,
      value: Number((totalsByOwner.totalDays / totalsByOwner.count).toFixed(1)),
      note: `${totalsByOwner.count} record${totalsByOwner.count === 1 ? '' : 's'}`,
    }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, limit)
}

function buildHeatmap(records: ActivityRecord[], efforts: string[], impacts: string[]) {
  const counts = new Map<string, number>()

  for (const record of records) {
    const key = `${record.effort}:${record.impact}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const cells: HeatmapCell[] = []
  for (const effort of efforts) {
    for (const impact of impacts) {
      cells.push({
        effort,
        impact,
        value: counts.get(`${effort}:${impact}`) ?? 0,
      })
    }
  }

  return cells
}

function formatImpactFactor(value: number) {
  if (!Number.isFinite(value)) {
    return '1'
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function normalizeCategoryImpactFactors(
  categories: string[],
  factors: Record<string, number>,
) {
  const normalized: Record<string, number> = {}

  for (const category of categories) {
    const factor = factors[category]
    normalized[category] = Number.isFinite(factor)
      ? Math.min(2, Math.max(0, factor))
      : 1
  }

  return normalized
}

function parseCategoryImpactFactor(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : null
}

function categoriesImpactFactor(
  categories: string[],
  factors: Record<string, number>,
) {
  const selectedFactors = categories.map((category) => factors[category] ?? 1)

  if (selectedFactors.length === 0) {
    return 1
  }

  return Math.max(...selectedFactors)
}

function recordCategoryImpactFactor(
  record: ActivityRecord,
  factors: Record<string, number>,
) {
  return categoriesImpactFactor(record.categories, factors)
}

function buildMonthlyOpenActivityBuckets(
  records: ActivityRecord[],
  factors: Record<string, number>,
  weighted = false,
) {
  if (records.length === 0) {
    return []
  }

  const starts = records.map((record) => dayjs(record.startDate))
  const ends = records.map((record) => dayjs(record.endDate))
  const firstMonth = starts
    .reduce((earliest, value) => (value.isBefore(earliest) ? value : earliest), starts[0])
    .startOf('month')
  const lastMonth = ends
    .reduce((latest, value) => (value.isAfter(latest) ? value : latest), ends[0])
    .startOf('month')
  const buckets: InsightBucket[] = []

  for (
    let cursor = firstMonth;
    cursor.isBefore(lastMonth) || cursor.isSame(lastMonth, 'month');
    cursor = cursor.add(1, 'month')
  ) {
    const monthStart = cursor.startOf('month')
    const monthEnd = cursor.endOf('month')
    const openRecords = records.filter((record) => {
      const recordStart = dayjs(record.startDate).startOf('day')
      const recordEnd = dayjs(record.endDate).endOf('day')

      return (
        !recordStart.isAfter(monthEnd, 'day') &&
        !recordEnd.isBefore(monthStart, 'day')
      )
    })
    const value = weighted
      ? openRecords.reduce(
          (sum, record) => sum + recordCategoryImpactFactor(record, factors),
          0,
        )
      : openRecords.length

    buckets.push({
      label: cursor.format('MMM YYYY'),
      value: Number(value.toFixed(1)),
    })
  }

  return buckets
}

const settingsFieldDefinitions: Array<{
  key: SettingsFieldKey
  label: string
  values: (settings: TrackerSettings) => string[]
  isUsedByRecord: (record: ActivityRecord, value: string) => boolean
  draftLine: (settings: TrackerSettings, value: string) => string
}> = [
  {
    key: 'owners',
    label: 'Owner',
    values: (settings) => settings.owners,
    isUsedByRecord: (record, value) => record.owner === value,
    draftLine: (_settings, value) => value,
  },
  {
    key: 'projects',
    label: 'Project',
    values: (settings) => settings.projects,
    isUsedByRecord: (record, value) => record.projects.includes(value),
    draftLine: (_settings, value) => value,
  },
  {
    key: 'departments',
    label: 'Department',
    values: (settings) => settings.departments,
    isUsedByRecord: (record, value) => record.departments.includes(value),
    draftLine: (_settings, value) => value,
  },
  {
    key: 'categories',
    label: 'Category',
    values: (settings) => settings.categories,
    isUsedByRecord: (record, value) => record.categories.includes(value),
    draftLine: (_settings, value) => value,
  },
  {
    key: 'priorities',
    label: 'Priority',
    values: (settings) => settings.priorities,
    isUsedByRecord: (record, value) => record.priority === value,
    draftLine: (_settings, value) => value,
  },
  {
    key: 'efforts',
    label: 'Effort',
    values: (settings) => settings.efforts,
    isUsedByRecord: (record, value) => record.effort === value,
    draftLine: (_settings, value) => value,
  },
  {
    key: 'impacts',
    label: 'Impact',
    values: (settings) => settings.impacts,
    isUsedByRecord: (record, value) => record.impact === value,
    draftLine: (_settings, value) => value,
  },
  {
    key: 'statuses',
    label: 'Status',
    values: (settings) => settings.statuses,
    isUsedByRecord: (record, value) => record.status === value,
    draftLine: (_settings, value) => value,
  },
  {
    key: 'reminderCadences',
    label: 'Reminder cadence',
    values: (settings) => settings.reminderCadences.map((entry) => entry.label),
    isUsedByRecord: (record, value) => record.reminderCadence === value,
    draftLine: (settings, value) => {
      const entry = settings.reminderCadences.find((option) => option.label === value)
      return entry ? `${entry.label} | ${entry.intervalDays}` : value
    },
  },
]

function settingsFromBootstrap(bootstrap: BootstrapPayload): TrackerSettings {
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

function buildDatabaseDocument(
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

function uniqueTrimmedLines(value: string) {
  return Array.from(
    new Set(
      value
        .split('\n')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  )
}

function serializeStringLines(values: string[]) {
  return values.join('\n')
}

function serializeReminderCadenceLines(values: ReminderCadenceOption[]) {
  return values.map((entry) => `${entry.label} | ${entry.intervalDays}`).join('\n')
}

function parseReminderCadenceLines(value: string) {
  return uniqueTrimmedLines(value).map((entry) => {
    const [labelPart, intervalPart] = entry.split('|').map((segment) => segment.trim())
    const intervalDays = Number(intervalPart)

    return {
      label: labelPart ?? '',
      intervalDays: Number.isFinite(intervalDays) && intervalDays >= 0 ? intervalDays : NaN,
    }
  })
}

function normalizeSingleValue(value: string | null, allowed: string[]) {
  if (value && allowed.includes(value)) {
    return value
  }

  return allowed[0] ?? null
}

function normalizeListValue(values: string[], allowed: string[]) {
  return values.filter((value, index, source) => allowed.includes(value) && source.indexOf(value) === index)
}

function normalizeFilters(filters: StatsFilters, settings: TrackerSettings): StatsFilters {
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

function findSettingsUsageConflicts(
  currentSettings: TrackerSettings,
  nextSettings: TrackerSettings,
  records: ActivityRecord[],
) {
  return settingsFieldDefinitions.flatMap((definition) => {
    const currentValues = definition.values(currentSettings)
    const nextValues = definition.values(nextSettings)
    const removedValues = currentValues.filter((value) => !nextValues.includes(value))

    return removedValues.flatMap((removedValue) => {
      const usages = records
        .filter((record) => definition.isUsedByRecord(record, removedValue))
        .map((record) => ({
          recordId: record.id,
          title: record.title,
        }))

      if (usages.length === 0) {
        return []
      }

      return [
        {
          field: definition.key,
          fieldLabel: definition.label,
          removedValue,
          removedDraftLine: definition.draftLine(currentSettings, removedValue),
          replacementOptions: nextValues,
          usages,
          replacement: nextValues[0] ?? null,
        },
      ]
    })
  })
}

function sortedComments(comments: RecordComment[]) {
  return [...comments].sort(
    (left, right) => dayjs(right.createdAt).valueOf() - dayjs(left.createdAt).valueOf(),
  )
}

function formatRecordKey(recordId: string) {
  return `TRK-${recordId.slice(0, 6).toUpperCase()}`
}

function formatWeeklyCommentBullet(message: string) {
  return message
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => `${index === 0 ? '' : '    '}${line}`)
    .join('\n')
}

function safeLoadSavedViews() {
  try {
    const raw = window.localStorage.getItem(savedViewsStorageKey)
    if (!raw) {
      return [] as SavedView[]
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return [] as SavedView[]
    }

    return parsed.filter(
      (entry): entry is SavedView =>
        typeof entry?.id === 'string' &&
        typeof entry?.name === 'string' &&
        typeof entry?.filters === 'object' &&
        entry.filters !== null,
    ).map((entry) => ({
      ...entry,
      filters: { ...emptySharedFilters, ...entry.filters },
    }))
  } catch {
    return [] as SavedView[]
  }
}

function reminderIntervalDays(
  cadence: ReminderCadence,
  reminderCadences: ReminderCadenceOption[],
) {
  const match = reminderCadences.find((entry) => entry.label === cadence)
  if (!match || match.intervalDays <= 0) {
    return null
  }

  return match.intervalDays
}

function recordTimelineMoments(record: ActivityRecord) {
  return [
    dayjs(record.lastModifiedAt || record.submittedAt),
    dayjs(record.submittedAt),
    ...record.comments.map((comment) => dayjs(comment.createdAt)),
    ...record.history.map((entry) => dayjs(entry.createdAt)),
  ]
}

function latestRecordMoment(record: ActivityRecord) {
  return recordTimelineMoments(record).sort((left, right) => right.valueOf() - left.valueOf())[0]
}

function recordConcurrencyToken(record: ActivityRecord) {
  return record.lastModifiedAt || record.submittedAt
}

function isConcurrencyConflictMessage(message: string) {
  return message.toLowerCase().includes('concurrency conflict')
}

function reminderDueMoment(
  record: ActivityRecord,
  reminderCadences: ReminderCadenceOption[],
) {
  const intervalDays = reminderIntervalDays(record.reminderCadence, reminderCadences)
  if (!intervalDays) {
    return null
  }

  return latestRecordMoment(record).add(intervalDays, 'day')
}

function recordSignalState(
  record: ActivityRecord,
  reminderCadences: ReminderCadenceOption[],
) {
  const today = dayjs().endOf('day')
  const endDate = dayjs(record.endDate)
  const latestMoment = latestRecordMoment(record)
  const reminderDue = reminderDueMoment(record, reminderCadences)
  const isCompleted = record.status.toLowerCase() === 'completed'

  return {
    overdue: !isCompleted && endDate.isBefore(today, 'day'),
    dueSoon:
      !isCompleted &&
      !endDate.isBefore(today, 'day') &&
      endDate.diff(dayjs().startOf('day'), 'day') <= 7,
    stale: !isCompleted && dayjs().diff(latestMoment, 'day') >= 14,
    reminderDue:
      !isCompleted && reminderDue !== null && reminderDue.isBefore(today.add(1, 'millisecond')),
    reminderDate: reminderDue,
    latestMoment,
  }
}

function signalBadges(record: ActivityRecord, reminderCadences: ReminderCadenceOption[]) {
  const signals = recordSignalState(record, reminderCadences)
  const badges: Array<{ label: string; color: string }> = []

  if (signals.overdue) {
    badges.push({ label: 'Overdue', color: 'red' })
  } else if (signals.dueSoon) {
    badges.push({ label: 'Due soon', color: 'yellow' })
  }

  if (signals.stale) {
    badges.push({ label: 'Stale', color: 'orange' })
  }

  if (signals.reminderDue) {
    badges.push({ label: 'Reminder due', color: 'grape' })
  }

  return badges
}

function extractMentions(message: string) {
  return Array.from(new Set(message.match(/@[A-Za-z0-9._-]+/g) ?? []))
}

function renderCommentWithMentions(message: string) {
  return message.split('\n').map((line, lineIndex) => {
    const parts = line.split(/(@[A-Za-z0-9._-]+)/g)
    return (
      <span key={`line-${lineIndex}`}>
        {parts.map((part, index) =>
          /^@[A-Za-z0-9._-]+$/.test(part) ? (
            <span className="mention-token" key={`${part}-${index}`}>
              {part}
            </span>
          ) : (
            <span key={`${lineIndex}-${index}`}>{part}</span>
          ),
        )}
        {lineIndex < message.split('\n').length - 1 ? <br /> : null}
      </span>
    )
  })
}

function activityStatusColor(status: ActivityStatus) {
  switch (status.toLowerCase()) {
    case 'scheduled':
      return 'grape'
    case 'open':
      return 'blue'
    case 'on hold':
      return 'yellow'
    case 'halted':
      return 'red'
    case 'completed':
      return 'teal'
    default:
      return 'gray'
  }
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  )
}

function DistributionCard({
  title,
  icon,
  buckets,
}: {
  title: string
  icon: React.ReactNode
  buckets: CountBucket[]
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)

  return (
    <Card radius="xl" padding="lg" className="surface-card">
      <Stack gap="md">
        <Group gap="sm">
          <ThemeIcon variant="light" color="blue" size="lg" radius="xl">
            {icon}
          </ThemeIcon>
          <div>
            <Text fw={700}>{title}</Text>
            <Text size="sm" c="dimmed">
              Distribution across all saved entries
            </Text>
          </div>
        </Group>

        {buckets.length === 0 ? (
          <Text size="sm" c="dimmed">
            No saved records yet.
          </Text>
        ) : (
          <Stack gap="sm">
            {buckets.map((bucket) => {
              const value = total === 0 ? 0 : (bucket.count / total) * 100

              return (
                <div key={bucket.label}>
                  <Group justify="space-between" mb={6}>
                    <Text size="sm" fw={600}>
                      {bucket.label}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {bucket.count}
                    </Text>
                  </Group>
                  <Progress
                    value={value}
                    radius="xl"
                    size="lg"
                    color={
                      bucket.label === 'High'
                        ? 'red'
                        : bucket.label === 'Mid'
                          ? 'yellow'
                          : 'blue'
                    }
                  />
                </div>
              )
            })}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}

function RankingCard({
  title,
  caption,
  buckets,
}: {
  title: string
  caption: string
  buckets: CountBucket[]
}) {
  return (
    <Card radius="xl" padding="lg" className="surface-card">
      <Stack gap="md">
        <div>
          <Text fw={700}>{title}</Text>
          <Text size="sm" c="dimmed">
            {caption}
          </Text>
        </div>

        {buckets.length === 0 ? (
          <Text size="sm" c="dimmed">
            No saved records yet.
          </Text>
        ) : (
          <Stack gap="sm">
            {buckets.map((bucket, index) => (
              <div className="rank-row" key={`${bucket.label}-${index}`}>
                <div>
                  <Text fw={600}>{bucket.label}</Text>
                  <Text size="sm" c="dimmed">
                    {bucket.count} record{bucket.count === 1 ? '' : 's'}
                  </Text>
                </div>
                <Badge variant="light" color="blue" radius="xl">
                  #{index + 1}
                </Badge>
              </div>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}

function InsightMetricCard({
  label,
  value,
  caption,
}: {
  label: string
  value: string
  caption: string
}) {
  return (
    <Card radius="xl" padding="lg" className="surface-card">
      <Text className="metric-label">{label}</Text>
      <Text className="insight-value">{value}</Text>
      <Text size="sm" c="dimmed" mt={8}>
        {caption}
      </Text>
    </Card>
  )
}

function TimelinePlot({
  title,
  subtitle,
  data,
}: {
  title: string
  subtitle: string
  data: InsightBucket[]
}) {
  const maxValue = data.reduce((current, item) => Math.max(current, item.value), 0)

  return (
    <Card radius="xl" padding="lg" className="surface-card">
      <Stack gap="md">
        <div>
          <Text fw={700}>{title}</Text>
          <Text size="sm" c="dimmed">
            {subtitle}
          </Text>
        </div>

        {data.length === 0 ? (
          <Text size="sm" c="dimmed">
            No records match the current filters.
          </Text>
        ) : (
          <div className="timeline-chart">
            {data.map((item) => (
              <div className="timeline-bar-group" key={item.label}>
                <Text size="xs" c="dimmed" fw={700}>
                  {item.value}
                </Text>
                <div
                  className="timeline-bar"
                  style={{
                    height: `${Math.max(16, (item.value / Math.max(maxValue, 1)) * 180)}px`,
                  }}
                />
                <Text size="xs" c="dimmed" className="timeline-label">
                  {item.label}
                </Text>
              </div>
            ))}
          </div>
        )}
      </Stack>
    </Card>
  )
}

function RankedPlot({
  title,
  subtitle,
  data,
}: {
  title: string
  subtitle: string
  data: InsightBucket[]
}) {
  const maxValue = data.reduce((current, item) => Math.max(current, item.value), 0)

  return (
    <Card radius="xl" padding="lg" className="surface-card">
      <Stack gap="md">
        <div>
          <Text fw={700}>{title}</Text>
          <Text size="sm" c="dimmed">
            {subtitle}
          </Text>
        </div>

        {data.length === 0 ? (
          <Text size="sm" c="dimmed">
            No records match the current filters.
          </Text>
        ) : (
          <div className="bar-plot-list">
            {data.map((item) => (
              <div className="bar-plot-row" key={item.label}>
                <div className="bar-plot-head">
                  <Text fw={600}>{item.label}</Text>
                  <Text size="sm" c="dimmed">
                    {item.value}
                  </Text>
                </div>
                <div className="bar-plot-track">
                  <div
                    className="bar-plot-fill"
                    style={{
                      width: `${(item.value / Math.max(maxValue, 1)) * 100}%`,
                    }}
                  />
                </div>
                {item.note ? (
                  <Text size="xs" c="dimmed">
                    {item.note}
                  </Text>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Stack>
    </Card>
  )
}

function heatmapCellTone(
  effort: string,
  impact: string,
  efforts: string[],
  impacts: string[],
  intensity: number,
) {
  const effortScore = efforts.indexOf(effort)
  const impactScore = impacts.indexOf(impact)
  const tradeoffScore = impactScore - effortScore
  const opacityBoost = intensity * 0.18

  if (tradeoffScore > 0) {
    return {
      background: `rgba(34, 139, 82, ${0.14 + tradeoffScore * 0.11 + opacityBoost})`,
      borderColor: `rgba(34, 139, 82, ${0.28 + tradeoffScore * 0.12 + opacityBoost})`,
    }
  }

  if (tradeoffScore < 0) {
    const risk = Math.abs(tradeoffScore)

    return {
      background: `rgba(213, 59, 43, ${0.12 + risk * 0.12 + opacityBoost})`,
      borderColor: `rgba(213, 59, 43, ${0.24 + risk * 0.14 + opacityBoost})`,
    }
  }

  return {
    background: `rgba(129, 139, 152, ${0.12 + opacityBoost})`,
    borderColor: `rgba(129, 139, 152, ${0.28 + opacityBoost})`,
  }
}

function HeatmapPlot({
  title,
  subtitle,
  cells,
  efforts,
  impacts,
  valueMode,
  onValueModeChange,
}: {
  title: string
  subtitle: string
  cells: HeatmapCell[]
  efforts: string[]
  impacts: string[]
  valueMode: HeatmapValueMode
  onValueModeChange: (value: HeatmapValueMode) => void
}) {
  const maxValue = cells.reduce((current, item) => Math.max(current, item.value), 0)
  const totalValue = cells.reduce((sum, item) => sum + item.value, 0)
  const orderedEfforts = [...efforts].reverse()

  return (
    <Card radius="xl" padding="lg" className="surface-card">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700}>{title}</Text>
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          </div>
          <SegmentedControl
            size="xs"
            radius="xl"
            data={[
              { value: 'count', label: 'Count' },
              { value: 'percent', label: '%' },
            ]}
            value={valueMode}
            onChange={(value) => onValueModeChange(value as HeatmapValueMode)}
          />
        </Group>

        <div className="heatmap-wrap">
          <div className="heatmap-header">
            <span />
            {impacts.map((impact) => (
              <Text key={impact} size="sm" fw={700} ta="center">
                {impact}
              </Text>
            ))}
          </div>
          <div className="heatmap-grid">
            {orderedEfforts.map((effort) => (
              <div className="heatmap-row" key={effort}>
                <Text size="sm" fw={700}>
                  {effort}
                </Text>
                {impacts.map((impact) => {
                  const cell =
                    cells.find(
                      (entry) => entry.effort === effort && entry.impact === impact,
                    ) ?? { effort, impact, value: 0 }
                  const intensity = maxValue === 0 ? 0 : cell.value / maxValue
                  const cellTone = heatmapCellTone(
                    effort,
                    impact,
                    efforts,
                    impacts,
                    intensity,
                  )
                  const cellLabel =
                    valueMode === 'percent'
                      ? `${formatMetricNumber(
                          totalValue === 0 ? 0 : (cell.value / totalValue) * 100,
                        )}%`
                      : cell.value

                  return (
                    <div
                      key={`${effort}-${impact}`}
                      className="heatmap-cell"
                      style={cellTone}
                    >
                      <strong>{cellLabel}</strong>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </Stack>
    </Card>
  )
}

function AdminTextListEditor({
  title,
  singularLabel,
  description,
  value,
  onChange,
}: {
  title: string
  singularLabel: string
  description: string
  value: string
  onChange: (value: string) => void
}) {
  const [newValue, setNewValue] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const items = uniqueTrimmedLines(value)

  function commitItems(nextItems: string[]) {
    onChange(serializeStringLines(nextItems))
  }

  function handleAddItem() {
    const nextValue = newValue.trim()
    if (!nextValue) {
      return
    }

    commitItems([...items, nextValue])
    setNewValue('')
  }

  function handleStartEdit(index: number, item: string) {
    setEditingIndex(index)
    setEditingValue(item)
  }

  function handleSaveEdit(index: number) {
    const nextValue = editingValue.trim()
    if (!nextValue) {
      return
    }

    commitItems(items.map((item, itemIndex) => (itemIndex === index ? nextValue : item)))
    setEditingIndex(null)
    setEditingValue('')
  }

  function handleRemoveItem(index: number) {
    commitItems(items.filter((_, itemIndex) => itemIndex !== index))
    if (editingIndex === index) {
      setEditingIndex(null)
      setEditingValue('')
    }
  }

  return (
    <Card radius="xl" padding="lg" className="surface-card admin-list-card">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700}>{title}</Text>
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          </div>
          <Badge variant="light" color="blue" radius="xl">
            {items.length} item{items.length === 1 ? '' : 's'}
          </Badge>
        </Group>

        <div className="admin-item-list">
          {items.length === 0 ? (
            <Text size="sm" c="dimmed">
              No values yet. Add the first one below.
            </Text>
          ) : (
            items.map((item, index) => (
              <div className="admin-item-row" key={`${title}-${item}-${index}`}>
                {editingIndex === index ? (
                  <TextInput
                    value={editingValue}
                    onChange={(event) => setEditingValue(event.currentTarget.value)}
                    className="admin-item-input"
                    autoFocus
                  />
                ) : (
                  <div className="admin-item-content">
                    <Text fw={700}>{item}</Text>
                    <Text size="xs" c="dimmed">
                      {singularLabel} value
                    </Text>
                  </div>
                )}

                <Group gap="xs" className="admin-item-actions">
                  {editingIndex === index ? (
                    <>
                      <Button
                        type="button"
                        variant="light"
                        color="green"
                        radius="xl"
                        size="compact-sm"
                        leftSection={<IconCheck size={14} />}
                        onClick={() => handleSaveEdit(index)}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        size="compact-sm"
                        leftSection={<IconX size={14} />}
                        onClick={() => {
                          setEditingIndex(null)
                          setEditingValue('')
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="subtle"
                        color="blue"
                        radius="xl"
                        size="compact-sm"
                        leftSection={<IconEdit size={14} />}
                        onClick={() => handleStartEdit(index, item)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="subtle"
                        color="red"
                        radius="xl"
                        size="compact-sm"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => handleRemoveItem(index)}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </Group>
              </div>
            ))
          )}
        </div>

        <div className="admin-add-row">
          <TextInput
            label={`Add ${singularLabel.toLowerCase()}`}
            placeholder={`New ${singularLabel.toLowerCase()}`}
            value={newValue}
            onChange={(event) => setNewValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleAddItem()
              }
            }}
          />
          <Button
            type="button"
            radius="xl"
            variant="light"
            color="blue"
            onClick={handleAddItem}
            disabled={!newValue.trim()}
          >
            Add
          </Button>
        </div>
      </Stack>
    </Card>
  )
}

function AdminCategoryImpactEditor({
  value,
  factors,
  onChange,
  onFactorsChange,
}: {
  value: string
  factors: Record<string, number>
  onChange: (value: string) => void
  onFactorsChange: (value: Record<string, number>) => void
}) {
  const [newValue, setNewValue] = useState('')
  const [newFactor, setNewFactor] = useState('1')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [editingFactor, setEditingFactor] = useState('1')
  const items = uniqueTrimmedLines(value)
  const normalizedFactors = normalizeCategoryImpactFactors(items, factors)

  function commitItems(nextItems: string[], nextFactors: Record<string, number>) {
    onChange(serializeStringLines(nextItems))
    onFactorsChange(normalizeCategoryImpactFactors(nextItems, nextFactors))
  }

  function handleAddItem() {
    const category = newValue.trim()
    const factor = parseCategoryImpactFactor(newFactor)
    if (!category || factor === null) {
      return
    }

    commitItems([...items, category], { ...normalizedFactors, [category]: factor })
    setNewValue('')
    setNewFactor('1')
  }

  function handleStartEdit(index: number, item: string) {
    setEditingIndex(index)
    setEditingValue(item)
    setEditingFactor(formatImpactFactor(normalizedFactors[item] ?? 1))
  }

  function handleSaveEdit(index: number) {
    const category = editingValue.trim()
    const factor = parseCategoryImpactFactor(editingFactor)
    if (!category || factor === null) {
      return
    }

    const previousCategory = items[index]
    const nextItems = items.map((item, itemIndex) =>
      itemIndex === index ? category : item,
    )
    const nextFactors = { ...normalizedFactors }
    delete nextFactors[previousCategory]
    nextFactors[category] = factor
    commitItems(nextItems, nextFactors)
    setEditingIndex(null)
    setEditingValue('')
    setEditingFactor('1')
  }

  function handleRemoveItem(index: number) {
    const removedCategory = items[index]
    const nextItems = items.filter((_, itemIndex) => itemIndex !== index)
    const nextFactors = { ...normalizedFactors }
    delete nextFactors[removedCategory]
    commitItems(nextItems, nextFactors)
    if (editingIndex === index) {
      setEditingIndex(null)
      setEditingValue('')
      setEditingFactor('1')
    }
  }

  return (
    <Card radius="xl" padding="lg" className="surface-card admin-list-card">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700}>Categories</Text>
            <Text size="sm" c="dimmed">
              Activity types used by records, with a weighting factor for Insights.
            </Text>
          </div>
          <Badge variant="light" color="blue" radius="xl">
            {items.length} type{items.length === 1 ? '' : 's'}
          </Badge>
        </Group>

        <div className="admin-item-list">
          {items.length === 0 ? (
            <Text size="sm" c="dimmed">
              No categories yet. Add the first activity type below.
            </Text>
          ) : (
            items.map((item, index) => (
              <div className="admin-item-row" key={`category-${item}-${index}`}>
                {editingIndex === index ? (
                  <div className="admin-reminder-edit">
                    <TextInput
                      label="Category"
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.currentTarget.value)}
                      autoFocus
                    />
                    <TextInput
                      label="Impact factor"
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={editingFactor}
                      onChange={(event) => setEditingFactor(event.currentTarget.value)}
                    />
                  </div>
                ) : (
                  <div className="admin-item-content">
                    <Text fw={700}>{item}</Text>
                    <Text size="xs" c="dimmed">
                      Impact factor {formatImpactFactor(normalizedFactors[item] ?? 1)}
                    </Text>
                  </div>
                )}

                <Group gap="xs" className="admin-item-actions">
                  {editingIndex === index ? (
                    <>
                      <Button
                        type="button"
                        variant="light"
                        color="green"
                        radius="xl"
                        size="compact-sm"
                        leftSection={<IconCheck size={14} />}
                        onClick={() => handleSaveEdit(index)}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        size="compact-sm"
                        leftSection={<IconX size={14} />}
                        onClick={() => {
                          setEditingIndex(null)
                          setEditingValue('')
                          setEditingFactor('1')
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="subtle"
                        color="blue"
                        radius="xl"
                        size="compact-sm"
                        leftSection={<IconEdit size={14} />}
                        onClick={() => handleStartEdit(index, item)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="subtle"
                        color="red"
                        radius="xl"
                        size="compact-sm"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => handleRemoveItem(index)}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </Group>
              </div>
            ))
          )}
        </div>

        <div className="admin-add-row admin-add-row-wide">
          <TextInput
            label="Add category"
            placeholder="New activity type"
            value={newValue}
            onChange={(event) => setNewValue(event.currentTarget.value)}
          />
          <TextInput
            label="Impact factor"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={newFactor}
            onChange={(event) => setNewFactor(event.currentTarget.value)}
          />
          <Button
            type="button"
            radius="xl"
            variant="light"
            color="blue"
            onClick={handleAddItem}
            disabled={!newValue.trim() || parseCategoryImpactFactor(newFactor) === null}
          >
            Add
          </Button>
        </div>

        <Text size="xs" c="dimmed">
          Use 1 as neutral weight. Values below 1 reduce weighted open activity;
          values above 1 increase it.
        </Text>
      </Stack>
    </Card>
  )
}

function AdminReminderCadenceEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [newLabel, setNewLabel] = useState('')
  const [newDays, setNewDays] = useState('0')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [editingDays, setEditingDays] = useState('')
  const items = parseReminderCadenceLines(value)

  function commitItems(nextItems: ReminderCadenceOption[]) {
    onChange(serializeReminderCadenceLines(nextItems))
  }

  function parseDays(rawValue: string) {
    const parsed = Number(rawValue)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }

  function handleAddItem() {
    const label = newLabel.trim()
    const intervalDays = parseDays(newDays)
    if (!label || intervalDays === null) {
      return
    }

    commitItems([...items, { label, intervalDays }])
    setNewLabel('')
    setNewDays('0')
  }

  function handleStartEdit(index: number, item: ReminderCadenceOption) {
    setEditingIndex(index)
    setEditingLabel(item.label)
    setEditingDays(Number.isNaN(item.intervalDays) ? '' : String(item.intervalDays))
  }

  function handleSaveEdit(index: number) {
    const label = editingLabel.trim()
    const intervalDays = parseDays(editingDays)
    if (!label || intervalDays === null) {
      return
    }

    commitItems(
      items.map((item, itemIndex) =>
        itemIndex === index ? { label, intervalDays } : item,
      ),
    )
    setEditingIndex(null)
    setEditingLabel('')
    setEditingDays('')
  }

  return (
    <Card radius="xl" padding="lg" className="surface-card admin-list-card">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700}>Reminder cadences</Text>
            <Text size="sm" c="dimmed">
              Configure reminder names and their interval in days.
            </Text>
          </div>
          <Badge variant="light" color="blue" radius="xl">
            {items.length} cadence{items.length === 1 ? '' : 's'}
          </Badge>
        </Group>

        <div className="admin-item-list">
          {items.map((item, index) => (
            <div className="admin-item-row" key={`${item.label}-${index}`}>
              {editingIndex === index ? (
                <div className="admin-reminder-edit">
                  <TextInput
                    label="Label"
                    value={editingLabel}
                    onChange={(event) => setEditingLabel(event.currentTarget.value)}
                    autoFocus
                  />
                  <TextInput
                    label="Days"
                    type="number"
                    min={0}
                    value={editingDays}
                    onChange={(event) => setEditingDays(event.currentTarget.value)}
                  />
                </div>
              ) : (
                <div className="admin-item-content">
                  <Text fw={700}>{item.label || 'Unnamed cadence'}</Text>
                  <Text size="xs" c={Number.isNaN(item.intervalDays) ? 'red' : 'dimmed'}>
                    {Number.isNaN(item.intervalDays)
                      ? 'Invalid interval'
                      : item.intervalDays === 0
                        ? 'No scheduled reminder'
                        : `Every ${item.intervalDays} day${item.intervalDays === 1 ? '' : 's'}`}
                  </Text>
                </div>
              )}

              <Group gap="xs" className="admin-item-actions">
                {editingIndex === index ? (
                  <>
                    <Button
                      type="button"
                      variant="light"
                      color="green"
                      radius="xl"
                      size="compact-sm"
                      leftSection={<IconCheck size={14} />}
                      onClick={() => handleSaveEdit(index)}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="subtle"
                      color="gray"
                      radius="xl"
                      size="compact-sm"
                      leftSection={<IconX size={14} />}
                      onClick={() => {
                        setEditingIndex(null)
                        setEditingLabel('')
                        setEditingDays('')
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="subtle"
                      color="blue"
                      radius="xl"
                      size="compact-sm"
                      leftSection={<IconEdit size={14} />}
                      onClick={() => handleStartEdit(index, item)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="subtle"
                      color="red"
                      radius="xl"
                      size="compact-sm"
                      leftSection={<IconTrash size={14} />}
                      onClick={() =>
                        commitItems(items.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      Remove
                    </Button>
                  </>
                )}
              </Group>
            </div>
          ))}
        </div>

        <div className="admin-add-row admin-add-row-wide">
          <TextInput
            label="Add cadence"
            placeholder="Label"
            value={newLabel}
            onChange={(event) => setNewLabel(event.currentTarget.value)}
          />
          <TextInput
            label="Interval days"
            type="number"
            min={0}
            value={newDays}
            onChange={(event) => setNewDays(event.currentTarget.value)}
          />
          <Button
            type="button"
            radius="xl"
            variant="light"
            color="blue"
            onClick={handleAddItem}
            disabled={!newLabel.trim() || parseDays(newDays) === null}
          >
            Add
          </Button>
        </div>
      </Stack>
    </Card>
  )
}

function App() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const activeColorScheme = colorScheme === 'auto' ? 'light' : colorScheme
  const currentIsoYear = dayjs().isoWeekYear()
  const currentIsoWeek = dayjs().isoWeek()
  const currentIsoWeekStart = dayjs().startOf('isoWeek')
  const currentIsoWeekEnd = dayjs().endOf('isoWeek')
  const [currentPage, setCurrentPage] = useState<PageKey>('overview')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false)
  const [bootstrapData, setBootstrapData] =
    useState<BootstrapPayload>(fallbackBootstrap)
  const [stats, setStats] = useState<DatabaseStats>(fallbackStats)
  const [sharedFilters, setSharedFilters] =
    useState<StatsFilters>(emptySharedFilters)
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => safeLoadSavedViews())
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(null)
  const [newSavedViewName, setNewSavedViewName] = useState('')
  const [records, setRecords] = useState<ActivityRecord[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [editingRecordVersion, setEditingRecordVersion] = useState<string | null>(null)
  const [quickOwner, setQuickOwner] = useState<string | null>(null)
  const [quickStatus, setQuickStatus] = useState<ActivityStatus | null>(null)
  const [quickReminderCadence, setQuickReminderCadence] =
    useState<ReminderCadence | null>(null)
  const [weeklyReportMode, setWeeklyReportMode] =
    useState<WeeklyReportMode>('week')
  const [weeklyTemplate, setWeeklyTemplate] = useState<WeeklyTemplate>('bullets')
  const [weeklyReportYear, setWeeklyReportYear] = useState(String(currentIsoYear))
  const [weeklyReportWeek, setWeeklyReportWeek] = useState(String(currentIsoWeek))
  const [weeklyRangeStart, setWeeklyRangeStart] = useState<Date | null>(
    currentIsoWeekStart.toDate(),
  )
  const [weeklyRangeEnd, setWeeklyRangeEnd] = useState<Date | null>(
    currentIsoWeekEnd.toDate(),
  )
  const [weeklyCopyState, setWeeklyCopyState] = useState<'idle' | 'success' | 'error'>(
    'idle',
  )
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isRefreshingStats, setIsRefreshingStats] = useState(false)
  const [isRefreshingRecords, setIsRefreshingRecords] = useState(false)
  const [isRefreshingBackups, setIsRefreshingBackups] = useState(false)
  const [isRefreshingAttachmentStats, setIsRefreshingAttachmentStats] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isQuickSaving, setIsQuickSaving] = useState(false)
  const [isSavingComment, setIsSavingComment] = useState(false)
  const [isRestoringBackupPath, setIsRestoringBackupPath] = useState<string | null>(null)
  const [isDeletingCommentId, setIsDeletingCommentId] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [draggingRecordId, setDraggingRecordId] = useState<string | null>(null)
  const [isFiltersCollapsed, setIsFiltersCollapsed] = useState(true)
  const [showCompletedColumn, setShowCompletedColumn] = useState(false)
  const [heatmapValueMode, setHeatmapValueMode] =
    useState<HeatmapValueMode>('count')
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [importExportMessage, setImportExportMessage] = useState<string | null>(null)
  const [databaseBackups, setDatabaseBackups] = useState<DatabaseBackup[]>([])
  const [attachmentStorageStats, setAttachmentStorageStats] =
    useState<AttachmentStorageStats>({ fileCount: 0, totalSizeBytes: 0 })
  const [refreshErrors, setRefreshErrors] = useState<RefreshErrorMap>({})
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsConflictError, setSettingsConflictError] = useState<string | null>(null)
  const [settingsConflicts, setSettingsConflicts] = useState<SettingsUsageConflict[]>([])
  const [pendingSettingsPayload, setPendingSettingsPayload] =
    useState<TrackerSettings | null>(null)
  const [ownersDraft, setOwnersDraft] = useState(serializeStringLines(fallbackBootstrap.owners))
  const [projectsDraft, setProjectsDraft] = useState(
    serializeStringLines(fallbackBootstrap.projects),
  )
  const [departmentsDraft, setDepartmentsDraft] = useState(
    serializeStringLines(fallbackBootstrap.departments),
  )
  const [categoriesDraft, setCategoriesDraft] = useState(
    serializeStringLines(fallbackBootstrap.categories),
  )
  const [categoryImpactFactorsDraft, setCategoryImpactFactorsDraft] = useState(
    normalizeCategoryImpactFactors(
      fallbackBootstrap.categories,
      fallbackBootstrap.categoryImpactFactors,
    ),
  )
  const [prioritiesDraft, setPrioritiesDraft] = useState(
    serializeStringLines(fallbackBootstrap.priorities),
  )
  const [effortsDraft, setEffortsDraft] = useState(
    serializeStringLines(fallbackBootstrap.efforts),
  )
  const [impactsDraft, setImpactsDraft] = useState(
    serializeStringLines(fallbackBootstrap.impacts),
  )
  const [statusesDraft, setStatusesDraft] = useState(
    serializeStringLines(fallbackBootstrap.statuses),
  )
  const [reminderCadencesDraft, setReminderCadencesDraft] = useState(
    serializeReminderCadenceLines(fallbackBootstrap.reminderCadences),
  )
  const [commentError, setCommentError] = useState<string | null>(null)
  const [commentMessage, setCommentMessage] = useState('')
  const [commentAttachments, setCommentAttachments] = useState<AttachmentPayload[]>([])
  const [areCommentsCollapsed, setAreCommentsCollapsed] = useState(true)
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(true)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentMessage, setEditingCommentMessage] = useState('')
  const [previewAttachmentKey, setPreviewAttachmentKey] = useState<string | null>(null)
  const [previewAttachmentDataByKey, setPreviewAttachmentDataByKey] =
    useState<Record<string, AttachmentData>>({})
  const [loadingAttachmentKey, setLoadingAttachmentKey] = useState<string | null>(null)
  const [statusTone, setStatusTone] = useState<'success' | 'error' | 'info'>(
    'info',
  )
  const [statusMessage, setStatusMessage] = useState(
    'Loading resource lists and database information...',
  )
  const trackerSettings = settingsFromBootstrap(bootstrapData)
  const trackerStatusOptions = bootstrapData.statuses.map((value) => ({
    value,
    label: value,
  }))
  const priorityOptions = bootstrapData.priorities.map((value) => ({
    value,
    label: value,
  }))
  const effortOptions = bootstrapData.efforts.map((value) => ({
    value,
    label: value,
  }))
  const impactOptions = bootstrapData.impacts.map((value) => ({
    value,
    label: value,
  }))
  const reminderOptions = bootstrapData.reminderCadences.map((value) => ({
    value: value.label,
    label: value.intervalDays > 0 ? `${value.label} (${value.intervalDays}d)` : value.label,
  }))
  const completedStatusLabel =
    bootstrapData.statuses.find((status) => status.toLowerCase() === 'completed') ?? null
  const activeRefreshErrors = Object.entries(refreshErrors).filter(
    (entry): entry is [keyof RefreshErrorMap, string] => Boolean(entry[1]),
  )

  const form = useForm<ActivityFormValues>({
    initialValues,
    validate: {
      title: (value) =>
        value.trim().length >= 3 ? null : 'Use a clear title with at least 3 characters',
      owner: (value) => (value ? null : 'Pick an owner'),
      projects: (value) =>
        value.length > 0 ? null : 'Select at least one project',
      startDate: (value) => (value ? null : 'Choose a start date'),
      endDate: (value, values) => {
        if (!value) {
          return 'Choose an end date'
        }

        if (values.startDate && dayjs(value).isBefore(dayjs(values.startDate), 'day')) {
          return 'End date cannot be earlier than the start date'
        }

        return null
      },
      departments: (value) =>
        value.length > 0 ? null : 'Select at least one department',
      description: (value) =>
        value.trim().length >= 10 ? null : 'Add a short description with at least 10 characters',
      effort: (value) => (value ? null : 'Set an effort level'),
      impact: (value) => (value ? null : 'Set an impact level'),
      priority: (value) => (value ? null : 'Set a priority level'),
      status: (value) => (value ? null : 'Set a status'),
      reminderCadence: (value) => (value ? null : 'Set a reminder cadence'),
      categories: (value) =>
        value.length > 0 ? null : 'Select at least one category',
      attachments: (value) =>
        value.length <= 10 ? null : 'Attach up to 10 files per record',
    },
  })
  const selectedCategoryImpactFactor =
    form.values.categories.length === 0
      ? null
      : categoriesImpactFactor(
          form.values.categories,
          bootstrapData.categoryImpactFactors,
        )
  const selectedCategoryImpactDetails = form.values.categories.map((category) => ({
    category,
    factor: bootstrapData.categoryImpactFactors[category] ?? 1,
  }))

  async function appendAttachments(nextAttachments: AttachmentPayload[]) {
    if (nextAttachments.length === 0) {
      return
    }

    setAttachmentError(null)
    const result = mergeAttachments(form.values.attachments, nextAttachments, 'record')
    if (result.error) {
      setAttachmentError(result.error)
      return
    }

    form.setFieldValue('attachments', result.attachments)
  }

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0) {
      return
    }

    try {
      await appendAttachments(await Promise.all(files.map(fileToAttachment)))
    } catch {
      setAttachmentError('One or more files could not be read.')
    }
  }

  async function appendCommentAttachments(nextAttachments: AttachmentPayload[]) {
    if (nextAttachments.length === 0) {
      return
    }

    setCommentError(null)
    const result = mergeAttachments(commentAttachments, nextAttachments, 'comment')
    if (result.error) {
      setCommentError(result.error)
      return
    }

    setCommentAttachments(result.attachments)
  }

  async function addCommentFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0) {
      return
    }

    try {
      await appendCommentAttachments(await Promise.all(files.map(fileToAttachment)))
    } catch {
      setCommentError('One or more comment attachments could not be read.')
    }
  }

  function removeCommentAttachment(indexToRemove: number) {
    setCommentAttachments((current) =>
      current.filter((_, index) => index !== indexToRemove),
    )
  }

  function removeAttachment(indexToRemove: number) {
    form.setFieldValue(
      'attachments',
      form.values.attachments.filter((_, index) => index !== indexToRemove),
    )
  }

  function startEditingRecord(record: ActivityRecord) {
    form.setValues({
      title: record.title,
      owner: record.owner,
      projects: [...record.projects],
      startDate: dayjs(record.startDate).toDate(),
      endDate: dayjs(record.endDate).toDate(),
      departments: [...record.departments],
      description: record.description,
      effort: record.effort,
      impact: record.impact,
      priority: record.priority,
      status: record.status,
      reminderCadence: record.reminderCadence,
      categories: [...record.categories],
      attachments: [...record.attachments],
    })
    setEditingRecordId(record.id)
    setEditingRecordVersion(recordConcurrencyToken(record))
    setAttachmentError(null)
    setCurrentPage('form')
    setStatusTone('info')
    setStatusMessage(`Editing record "${record.title}". Save to update it in the database.`)
  }

  function cancelEditingRecord() {
    form.reset()
    setEditingRecordId(null)
    setEditingRecordVersion(null)
    setAttachmentError(null)
    setStatusTone('info')
    setStatusMessage('Edit cancelled. The form is back in create mode.')
  }

  const hasActiveFilters =
    sharedFilters.searchTerm.trim().length > 0 ||
    sharedFilters.owners.length > 0 ||
    sharedFilters.departments.length > 0 ||
    sharedFilters.categories.length > 0 ||
    sharedFilters.projects.length > 0 ||
    sharedFilters.priorities.length > 0 ||
    sharedFilters.statuses.length > 0 ||
    sharedFilters.efforts.length > 0 ||
    sharedFilters.impacts.length > 0
  const filteredRecords = records.filter((record) =>
    matchesSharedFilters(record, sharedFilters),
  )
  const activeFilterGroups = [
    {
      label: 'Search',
      value: sharedFilters.searchTerm.trim() || null,
    },
    {
      label: 'Owner',
      value:
        sharedFilters.owners.length === 1
          ? sharedFilters.owners[0]
          : sharedFilters.owners.length > 1
            ? `${sharedFilters.owners.length} selected`
            : null,
    },
    {
      label: 'Project',
      value:
        sharedFilters.projects.length === 1
          ? sharedFilters.projects[0]
          : sharedFilters.projects.length > 1
            ? `${sharedFilters.projects.length} selected`
            : null,
    },
    {
      label: 'Department',
      value:
        sharedFilters.departments.length === 1
          ? sharedFilters.departments[0]
          : sharedFilters.departments.length > 1
            ? `${sharedFilters.departments.length} selected`
            : null,
    },
    {
      label: 'Category',
      value:
        sharedFilters.categories.length === 1
          ? sharedFilters.categories[0]
          : sharedFilters.categories.length > 1
            ? `${sharedFilters.categories.length} selected`
            : null,
    },
    {
      label: 'Status',
      value:
        sharedFilters.statuses.length === 1
          ? sharedFilters.statuses[0]
          : sharedFilters.statuses.length > 1
            ? `${sharedFilters.statuses.length} selected`
            : null,
    },
    {
      label: 'Priority',
      value:
        sharedFilters.priorities.length === 1
          ? sharedFilters.priorities[0]
          : sharedFilters.priorities.length > 1
            ? `${sharedFilters.priorities.length} selected`
            : null,
    },
    {
      label: 'Effort',
      value:
        sharedFilters.efforts.length === 1
          ? sharedFilters.efforts[0]
          : sharedFilters.efforts.length > 1
            ? `${sharedFilters.efforts.length} selected`
            : null,
    },
    {
      label: 'Impact',
      value:
        sharedFilters.impacts.length === 1
          ? sharedFilters.impacts[0]
          : sharedFilters.impacts.length > 1
            ? `${sharedFilters.impacts.length} selected`
            : null,
    },
  ].filter((entry) => entry.value !== null)
  const activeFilterSummary =
    activeFilterGroups.length === 0
      ? 'No filters applied. Showing the full workspace.'
      : activeFilterGroups
          .map((entry) => `${entry.label}: ${entry.value}`)
          .join(' · ')
  const selectedRecord =
    filteredRecords.find((record) => record.id === selectedRecordId) ?? null
  const selectedRecordComments = selectedRecord
    ? sortedComments(selectedRecord.comments)
    : []
  const selectedRecordHistory = selectedRecord
    ? [...selectedRecord.history].sort(
        (left, right) =>
          dayjs(right.createdAt).valueOf() - dayjs(left.createdAt).valueOf(),
      )
    : []
  const filteredRecordSignals = filteredRecords.map((record) => ({
    record,
    signals: recordSignalState(record, bootstrapData.reminderCadences),
  }))
  const overdueCount = filteredRecordSignals.filter((entry) => entry.signals.overdue).length
  const dueSoonCount = filteredRecordSignals.filter((entry) => entry.signals.dueSoon).length
  const staleCount = filteredRecordSignals.filter((entry) => entry.signals.stale).length
  const reminderDueCount = filteredRecordSignals.filter(
    (entry) => entry.signals.reminderDue,
  ).length
  const boardColumns = bootstrapData.statuses
    .filter((status) => showCompletedColumn || status !== completedStatusLabel)
    .map((status) => ({
      status,
      records: filteredRecords.filter((record) => record.status === status),
    }))
  const filteredInsightRecords = filteredRecords
  const insightTimeline = buildMonthlyBuckets(filteredInsightRecords)
  const insightOpenActivitiesByMonth = buildMonthlyOpenActivityBuckets(
    filteredInsightRecords,
    bootstrapData.categoryImpactFactors,
  )
  const insightWeightedOpenActivitiesByMonth = buildMonthlyOpenActivityBuckets(
    filteredInsightRecords,
    bootstrapData.categoryImpactFactors,
    true,
  )
  const insightOwnerBuckets = countSingleValues(
    filteredInsightRecords,
    (record) => record.owner,
    6,
  )
  const insightDepartmentBuckets = countValues(
    filteredInsightRecords,
    (record) => record.departments,
    6,
  )
  const insightProjectBuckets = countValues(
    filteredInsightRecords,
    (record) => record.projects,
    6,
  )
  const insightCategoryBuckets = countValues(
    filteredInsightRecords,
    (record) => record.categories,
    6,
  )
  const insightHeatmap = buildHeatmap(
    filteredInsightRecords,
    bootstrapData.efforts,
    bootstrapData.impacts,
  )
  const featuredPriorityLabel =
    bootstrapData.priorities[bootstrapData.priorities.length - 1] ?? 'Top'
  const insightAverageDuration =
    filteredInsightRecords.length === 0
      ? 0
      : filteredInsightRecords.reduce(
          (sum, record) => sum + durationDays(record),
          0,
        ) / filteredInsightRecords.length
  const insightAttachmentCount = filteredInsightRecords.reduce(
    (sum, record) => sum + record.attachments.length,
    0,
  )
  const insightHighPriorityShare =
    filteredInsightRecords.length === 0
      ? 0
      : (filteredInsightRecords.filter((record) => record.priority === featuredPriorityLabel).length /
          filteredInsightRecords.length) *
        100
  const insightAverageAttachments =
    filteredInsightRecords.length === 0
      ? 0
      : insightAttachmentCount / filteredInsightRecords.length
  const insightDurationByOwner = buildAverageDurationBuckets(
    filteredInsightRecords,
    6,
  )
  const selectedWeeklyYear = Number(weeklyReportYear)
  const selectedWeeklyWeek = Number(weeklyReportWeek)
  const selectedWeeklyWeekCount = isoWeeksInYear(selectedWeeklyYear)
  const weeklyYearOptions = Array.from(
    new Set([
      currentIsoYear - 1,
      currentIsoYear,
      currentIsoYear + 1,
      ...records.flatMap((record) =>
        record.comments.map((comment) => dayjs(comment.createdAt).isoWeekYear()),
      ),
    ]),
  )
    .sort((left, right) => right - left)
    .map((value) => ({
      value: String(value),
      label: String(value),
    }))
  const weeklyWeekOptions = Array.from(
    { length: selectedWeeklyWeekCount },
    (_, index) => ({
      value: String(index + 1),
      label: `CWK ${index + 1}`,
    }),
  )
  const rawRangeStart = weeklyRangeStart ? dayjs(weeklyRangeStart).startOf('day') : null
  const rawRangeEnd = weeklyRangeEnd ? dayjs(weeklyRangeEnd).endOf('day') : null
  const selectedRangeStart =
    rawRangeStart && rawRangeEnd && rawRangeStart.isAfter(rawRangeEnd)
      ? rawRangeEnd.startOf('day')
      : rawRangeStart
  const selectedRangeEnd =
    rawRangeStart && rawRangeEnd && rawRangeStart.isAfter(rawRangeEnd)
      ? rawRangeStart.endOf('day')
      : rawRangeEnd
  const weeklyWindowStart =
    weeklyReportMode === 'week'
      ? dayjs(`${selectedWeeklyYear}-01-04`).isoWeek(selectedWeeklyWeek).startOf('isoWeek')
      : selectedRangeStart
  const weeklyWindowEnd =
    weeklyReportMode === 'week'
      ? dayjs(`${selectedWeeklyYear}-01-04`).isoWeek(selectedWeeklyWeek).endOf('isoWeek')
      : selectedRangeEnd
  const weeklyRangeLabel =
    weeklyReportMode === 'week'
      ? formatWeeklyRange(selectedWeeklyYear, selectedWeeklyWeek)
      : weeklyWindowStart && weeklyWindowEnd
        ? `${weeklyWindowStart.format('DD MMM YYYY')} - ${weeklyWindowEnd.format('DD MMM YYYY')}`
        : 'Select a custom date range'
  const weeklyWindowLabel =
    weeklyReportMode === 'week'
      ? `CWK ${selectedWeeklyWeek} ${selectedWeeklyYear}`
      : weeklyRangeLabel
  const weeklyReportEntries = filteredRecords
    .map((record) => ({
      record,
      comments: [...record.comments]
        .filter((comment) => {
          if (!weeklyWindowStart || !weeklyWindowEnd) {
            return false
          }

          const commentDate = dayjs(comment.createdAt)
          return (
            (commentDate.isAfter(weeklyWindowStart) || commentDate.isSame(weeklyWindowStart)) &&
            (commentDate.isBefore(weeklyWindowEnd) || commentDate.isSame(weeklyWindowEnd))
          )
        })
        .sort(
          (left, right) =>
            dayjs(left.createdAt).valueOf() - dayjs(right.createdAt).valueOf(),
        ),
    }))
    .filter((entry) => entry.comments.length > 0)
  const weeklyIncludedCommentCount = weeklyReportEntries.reduce(
    (sum, entry) => sum + entry.comments.length,
    0,
  )
  const weeklyExecutiveSummary =
    weeklyReportEntries.length === 0
      ? 'No activities were updated in the selected window.'
      : `${weeklyReportEntries.length} activities received ${weeklyIncludedCommentCount} updates across ${new Set(weeklyReportEntries.map((entry) => entry.record.owner)).size} owners and ${new Set(weeklyReportEntries.flatMap((entry) => entry.record.projects)).size} projects.`
  const weeklyGroupedByOwner = Array.from(
    weeklyReportEntries.reduce((groups, entry) => {
      const key = entry.record.owner
      groups.set(key, [...(groups.get(key) ?? []), entry])
      return groups
    }, new Map<string, typeof weeklyReportEntries>()),
  ).sort((left, right) => left[0].localeCompare(right[0]))
  const weeklyGroupedByProject = Array.from(
    weeklyReportEntries.reduce((groups, entry) => {
      for (const project of entry.record.projects) {
        groups.set(project, [...(groups.get(project) ?? []), entry])
      }
      return groups
    }, new Map<string, typeof weeklyReportEntries>()),
  ).sort((left, right) => left[0].localeCompare(right[0]))
  const weeklyReportText = [
    weeklyTemplate === 'executive'
      ? `Executive weekly report for ${weeklyWindowLabel}`
      : `Weekly report for ${weeklyWindowLabel}`,
    `Date range: ${weeklyRangeLabel}`,
    '',
    ...(!weeklyWindowStart || !weeklyWindowEnd
      ? ['Select both a start date and an end date to generate the report.']
      : weeklyReportEntries.length === 0
        ? ['No activity updates were recorded in the selected window.']
        : weeklyTemplate === 'executive'
          ? [
              weeklyExecutiveSummary,
              '',
              ...weeklyReportEntries.flatMap((entry) => [
                `- ${entry.record.title} (${entry.record.status}, ${entry.record.owner})`,
                ...entry.comments.map((comment) =>
                  `  - ${formatCommentDate(comment.createdAt)}: ${formatWeeklyCommentBullet(
                    comment.message,
                  )}`,
                ),
                '',
              ]),
            ]
          : weeklyTemplate === 'owner'
            ? weeklyGroupedByOwner.flatMap(([owner, entries]) => [
                `${owner}`,
                ...entries.flatMap((entry) => [
                  `- ${entry.record.title} (${formatRecordKey(entry.record.id)})`,
                  ...entry.comments.map((comment) =>
                    `  - ${formatCommentDate(comment.createdAt)}: ${formatWeeklyCommentBullet(
                      comment.message,
                    )}`,
                  ),
                  '',
                ]),
              ])
            : weeklyTemplate === 'project'
              ? weeklyGroupedByProject.flatMap(([project, entries]) => [
                  `${project}`,
                  ...entries.flatMap((entry) => [
                    `- ${entry.record.title} (${formatRecordKey(entry.record.id)})`,
                    ...entry.comments.map((comment) =>
                      `  - ${formatCommentDate(comment.createdAt)}: ${formatWeeklyCommentBullet(
                        comment.message,
                      )}`,
                    ),
                    '',
                  ]),
                ])
              : weeklyReportEntries.flatMap((entry) => [
                  `- ${entry.record.title} (${formatRecordKey(entry.record.id)})`,
                  ...entry.comments.map((comment) =>
                    `  - ${formatCommentDate(comment.createdAt)}: ${formatWeeklyCommentBullet(
                      comment.message,
                    )}`,
                  ),
                  '',
                ])),
  ]
    .join('\n')
    .trim()

  const handleDroppedPaths = useEffectEvent(async (paths: string[]) => {
    try {
      const attachments = await readAttachmentsFromPaths(paths)
      await appendAttachments(attachments)
    } catch (error) {
      setAttachmentError(
        error instanceof Error
          ? error.message
          : 'Dropped files could not be imported.',
      )
    }
  })

  useEffect(() => {
    let unlisten: (() => void) | undefined

    async function bindDragDrop() {
      unlisten = await getCurrentWindow().onDragDropEvent(async (event) => {
        if (currentPage !== 'form') {
          return
        }

        if (event.payload.type === 'over') {
          setIsDraggingFiles(true)
          return
        }

        if (event.payload.type === 'leave') {
          setIsDraggingFiles(false)
          return
        }

        setIsDraggingFiles(false)
        if (event.payload.type === 'drop') {
          await handleDroppedPaths(event.payload.paths)
        }
      })
    }

    void bindDragDrop()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [currentPage])

  useEffect(() => {
    setCommentMessage('')
    setCommentAttachments([])
    setCommentError(null)
    setEditingCommentId(null)
    setEditingCommentMessage('')
    setAreCommentsCollapsed(true)
    setIsHistoryCollapsed(true)
    setPreviewAttachmentKey(null)
    setPreviewAttachmentDataByKey({})
    setLoadingAttachmentKey(null)
  }, [selectedRecordId])

  useEffect(() => {
    window.localStorage.setItem(savedViewsStorageKey, JSON.stringify(savedViews))
  }, [savedViews])

  const applyBootstrapSettings = useEffectEvent((nextBootstrap: BootstrapPayload) => {
    const nextSettings = settingsFromBootstrap(nextBootstrap)

    setOwnersDraft(serializeStringLines(nextBootstrap.owners))
    setProjectsDraft(serializeStringLines(nextBootstrap.projects))
    setDepartmentsDraft(serializeStringLines(nextBootstrap.departments))
    setCategoriesDraft(serializeStringLines(nextBootstrap.categories))
    setCategoryImpactFactorsDraft(
      normalizeCategoryImpactFactors(
        nextBootstrap.categories,
        nextBootstrap.categoryImpactFactors,
      ),
    )
    setPrioritiesDraft(serializeStringLines(nextBootstrap.priorities))
    setEffortsDraft(serializeStringLines(nextBootstrap.efforts))
    setImpactsDraft(serializeStringLines(nextBootstrap.impacts))
    setStatusesDraft(serializeStringLines(nextBootstrap.statuses))
    setReminderCadencesDraft(
      serializeReminderCadenceLines(nextBootstrap.reminderCadences),
    )
    setSettingsError(null)

    setSharedFilters((current) => normalizeFilters(current, nextSettings))
    setQuickOwner((current) => normalizeSingleValue(current, nextBootstrap.owners))
    setQuickStatus(
      (current) =>
        normalizeSingleValue(current, nextBootstrap.statuses) as ActivityStatus | null,
    )
    setQuickReminderCadence((current) =>
      normalizeSingleValue(
        current,
        nextBootstrap.reminderCadences.map((entry) => entry.label),
      ),
    )

    form.setValues({
      ...form.values,
      owner: normalizeSingleValue(form.values.owner, nextBootstrap.owners),
      projects: normalizeListValue(form.values.projects, nextBootstrap.projects),
      departments: normalizeListValue(form.values.departments, nextBootstrap.departments),
      effort: normalizeSingleValue(form.values.effort, nextBootstrap.efforts),
      impact: normalizeSingleValue(form.values.impact, nextBootstrap.impacts),
      priority: normalizeSingleValue(form.values.priority, nextBootstrap.priorities),
      status: normalizeSingleValue(form.values.status, nextBootstrap.statuses),
      reminderCadence: normalizeSingleValue(
        form.values.reminderCadence,
        nextBootstrap.reminderCadences.map((entry) => entry.label),
      ),
      categories: normalizeListValue(form.values.categories, nextBootstrap.categories),
    })
  })

  useEffect(() => {
    applyBootstrapSettings(bootstrapData)
  }, [bootstrapData])

  useEffect(() => {
    setQuickOwner(selectedRecord?.owner ?? null)
    setQuickStatus(selectedRecord?.status ?? null)
    setQuickReminderCadence(selectedRecord?.reminderCadence ?? null)
  }, [selectedRecord])

  useEffect(() => {
    if (selectedWeeklyWeek > selectedWeeklyWeekCount) {
      setWeeklyReportWeek(String(selectedWeeklyWeekCount))
    }
  }, [selectedWeeklyWeek, selectedWeeklyWeekCount])

  useEffect(() => {
    setWeeklyCopyState('idle')
  }, [
    weeklyReportMode,
    weeklyTemplate,
    weeklyReportWeek,
    weeklyReportYear,
    weeklyRangeStart,
    weeklyRangeEnd,
    sharedFilters,
  ])

  useEffect(() => {
    if (filteredRecords.length === 0) {
      if (selectedRecordId !== null) {
        setSelectedRecordId(null)
      }
      return
    }

    if (selectedRecordId && filteredRecords.some((record) => record.id === selectedRecordId)) {
      return
    }

    setSelectedRecordId(filteredRecords[0]?.id ?? null)
  }, [filteredRecords, selectedRecordId])

  const handleGlobalKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) {
      return
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    if (event.key === '?') {
      event.preventDefault()
      setIsShortcutsModalOpen((current) => !current)
      return
    }

    if (/^[1-7]$/.test(event.key)) {
      const nextPage = orderedPages[Number(event.key) - 1]
      if (nextPage) {
        event.preventDefault()
        setCurrentPage(nextPage)
      }
      return
    }

    if (currentPage !== 'records' || filteredRecords.length === 0) {
      return
    }

    const currentIndex = selectedRecordId
      ? filteredRecords.findIndex((record) => record.id === selectedRecordId)
      : 0
    const safeIndex = currentIndex >= 0 ? currentIndex : 0

    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault()
      const nextRecord =
        filteredRecords[Math.min(safeIndex + 1, filteredRecords.length - 1)]
      if (nextRecord) {
        setSelectedRecordId(nextRecord.id)
      }
      return
    }

    if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault()
      const previousRecord = filteredRecords[Math.max(safeIndex - 1, 0)]
      if (previousRecord) {
        setSelectedRecordId(previousRecord.id)
      }
      return
    }

    if (event.key === 'e') {
      const currentSelectedRecord =
        filteredRecords.find((record) => record.id === selectedRecordId) ??
        filteredRecords[0] ??
        null

      if (currentSelectedRecord) {
        event.preventDefault()
        startEditingRecord(currentSelectedRecord)
      }
    }
  })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      handleGlobalKeyDown(event)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  async function refreshStats(options?: { silent?: boolean; filters?: StatsFilters }) {
    const silent = options?.silent ?? false
    const filters = options?.filters ?? sharedFilters

    if (!silent) {
      setIsRefreshingStats(true)
    }

    try {
      const nextStats = await getDatabaseStats(filters)
      startTransition(() => {
        setStats(nextStats)
        setRefreshErrors((current) => ({ ...current, stats: undefined }))
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to refresh statistics'
      setRefreshErrors((current) => ({ ...current, stats: message }))
      setStatusTone('error')
      setStatusMessage(message)
    } finally {
      if (!silent) {
        setIsRefreshingStats(false)
      }
    }
  }

  async function refreshRecords(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false

    if (!silent) {
      setIsRefreshingRecords(true)
    }

    try {
      const nextRecords = await getActivityRecords()
      startTransition(() => {
        setRecords(nextRecords)
        setRefreshErrors((current) => ({ ...current, records: undefined }))
        setSelectedRecordId((current) => {
          if (nextRecords.length === 0) {
            return null
          }

          if (current && nextRecords.some((record) => record.id === current)) {
            return current
          }

          return nextRecords[0]?.id ?? null
        })
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to refresh records'
      setRefreshErrors((current) => ({ ...current, records: message }))
      setStatusTone('error')
      setStatusMessage(message)
    } finally {
      if (!silent) {
        setIsRefreshingRecords(false)
      }
    }
  }

  async function refreshBackups(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false

    if (!silent) {
      setIsRefreshingBackups(true)
    }

    try {
      const nextBackups = await listDatabaseBackups()
      startTransition(() => {
        setDatabaseBackups(nextBackups)
        setRefreshErrors((current) => ({ ...current, backups: undefined }))
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to refresh database backups'
      setRefreshErrors((current) => ({ ...current, backups: message }))
      setStatusTone('error')
      setStatusMessage(message)
    } finally {
      if (!silent) {
        setIsRefreshingBackups(false)
      }
    }
  }

  async function refreshAttachmentStorageStats(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false

    if (!silent) {
      setIsRefreshingAttachmentStats(true)
    }

    try {
      const nextStats = await getAttachmentStorageStats()
      startTransition(() => {
        setAttachmentStorageStats(nextStats)
        setRefreshErrors((current) => ({ ...current, attachments: undefined }))
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to refresh attachment storage'
      setRefreshErrors((current) => ({ ...current, attachments: message }))
      setStatusTone('error')
      setStatusMessage(message)
    } finally {
      if (!silent) {
        setIsRefreshingAttachmentStats(false)
      }
    }
  }

  useEffect(() => {
    let active = true

    async function loadBootstrap() {
      try {
        const results = await Promise.allSettled([
          bootstrapForm(),
          getDatabaseStats(emptySharedFilters),
          getActivityRecords(),
          listDatabaseBackups(),
          getAttachmentStorageStats(),
        ])

        if (!active) {
          return
        }

        const [payloadResult, statsResult, recordsResult, backupsResult, attachmentStatsResult] =
          results
        const payload =
          payloadResult.status === 'fulfilled' ? payloadResult.value : fallbackBootstrap
        const dbStats =
          statsResult.status === 'fulfilled' ? statsResult.value : fallbackStats
        const loadedRecords =
          recordsResult.status === 'fulfilled' ? recordsResult.value : []
        const loadedBackups =
          backupsResult.status === 'fulfilled' ? backupsResult.value : []
        const loadedAttachmentStats =
          attachmentStatsResult.status === 'fulfilled'
            ? attachmentStatsResult.value
            : { fileCount: 0, totalSizeBytes: 0 }
        const nextErrors: RefreshErrorMap = {
          bootstrap:
            payloadResult.status === 'rejected'
              ? String(payloadResult.reason)
              : undefined,
          stats:
            statsResult.status === 'rejected' ? String(statsResult.reason) : undefined,
          records:
            recordsResult.status === 'rejected' ? String(recordsResult.reason) : undefined,
          backups:
            backupsResult.status === 'rejected' ? String(backupsResult.reason) : undefined,
          attachments:
            attachmentStatsResult.status === 'rejected'
              ? String(attachmentStatsResult.reason)
              : undefined,
        }
        const failedAreas = Object.entries(nextErrors).filter(([, value]) => value)

        startTransition(() => {
          setBootstrapData(payload)
          setStats(dbStats)
          setRecords(loadedRecords)
          setDatabaseBackups(loadedBackups)
          setAttachmentStorageStats(loadedAttachmentStats)
          setRefreshErrors(nextErrors)
          setSelectedRecordId(loadedRecords[0]?.id ?? null)
          setStatusTone(failedAreas.length === 0 ? 'info' : 'error')
          setStatusMessage(
            failedAreas.length === 0
              ? 'Connected to the desktop backend and ready to save records.'
              : `Loaded with ${failedAreas.length} refresh issue${failedAreas.length === 1 ? '' : 's'}. Existing data was preserved where possible.`,
          )
        })
      } catch (error) {
        if (!active) {
          return
        }

        const message =
          error instanceof Error ? error.message : 'Desktop backend unavailable'

        startTransition(() => {
          setBootstrapData(fallbackBootstrap)
          setStats(fallbackStats)
          setRecords([])
          setDatabaseBackups([])
          setSelectedRecordId(null)
          setStatusTone('error')
          setStatusMessage(
            `${message}. The form is still previewable, but saving requires running inside Tauri.`,
          )
        })
      } finally {
        if (active) {
          setIsBootstrapping(false)
        }
      }
    }

    loadBootstrap()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (isBootstrapping) {
      return
    }

    let active = true

    async function loadFilteredStats() {
      setIsRefreshingStats(true)

      try {
        const nextStats = await getDatabaseStats(sharedFilters)
        if (!active) {
          return
        }

        startTransition(() => {
          setStats(nextStats)
        })
      } catch (error) {
        if (!active) {
          return
        }

        const message =
          error instanceof Error ? error.message : 'Unable to refresh filtered statistics'
        setRefreshErrors((current) => ({ ...current, stats: message }))
        setStatusTone('error')
        setStatusMessage(message)
      } finally {
        if (active) {
          setIsRefreshingStats(false)
        }
      }
    }

    void loadFilteredStats()

    return () => {
      active = false
    }
  }, [isBootstrapping, sharedFilters])

  async function handleSubmit(values: ActivityFormValues) {
    setIsSaving(true)
    setStatusTone('info')
    setStatusMessage(
      editingRecordId
        ? 'Updating the selected activity record in the shared JSON database...'
        : 'Writing the activity record to the shared JSON database...',
    )

    try {
      const payload = {
        title: values.title.trim(),
        owner: values.owner ?? '',
        projects: values.projects,
        startDate: formatDate(values.startDate) ?? '',
        endDate: formatDate(values.endDate) ?? '',
        departments: values.departments,
        description: values.description.trim(),
        effort: values.effort ?? '',
        impact: values.impact ?? '',
        priority: values.priority ?? '',
        status: values.status ?? 'Open',
        reminderCadence: values.reminderCadence ?? 'None',
        categories: values.categories,
        attachments: values.attachments,
        expectedLastModifiedAt: editingRecordId ? editingRecordVersion : undefined,
      }
      const result = editingRecordId
        ? await updateActivity(editingRecordId, payload)
        : await submitActivity(payload)

      startTransition(() => {
        setBootstrapData((current) => ({
          ...current,
          dbPath: result.dbPath,
          dbRevision: result.dbRevision,
          recordCount: result.recordCount,
        }))
        setStatusTone('success')
        setStatusMessage(
          editingRecordId
            ? 'Activity updated successfully.'
            : 'Activity saved successfully.',
        )
        setCurrentPage(editingRecordId ? 'records' : 'overview')
        notifications.show({
          color: 'teal',
          title: editingRecordId ? 'Activity updated' : 'Activity saved',
          message: editingRecordId
            ? 'Record has been updated in the database.'
            : 'New record appended to the database.',
          autoClose: 4000,
        })
      })

      await refreshStats({ silent: true })
      await refreshRecords({ silent: true })
      await refreshAttachmentStorageStats({ silent: true })
      form.reset()
      setEditingRecordId(null)
      setEditingRecordVersion(null)
      setAttachmentError(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to write the record'

      if (isConcurrencyConflictMessage(message)) {
        await refreshRecords({ silent: true })
        await refreshStats({ silent: true })
      }

      startTransition(() => {
        setStatusTone('error')
        setStatusMessage(message)
        notifications.show({
          color: 'red',
          title: 'Save failed',
          message,
          autoClose: 6000,
        })
      })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleAppendComment() {
    if (!selectedRecord) {
      return
    }

    const message = commentMessage.trim()
    if (message.length === 0) {
      setCommentError('Comment text is required.')
      return
    }

    setIsSavingComment(true)
    setCommentError(null)
    setStatusTone('info')
    setStatusMessage('Appending a comment to the selected record...')

    try {
      const result = await appendActivityComment(selectedRecord.id, {
        message,
        attachments: commentAttachments,
        expectedLastModifiedAt: recordConcurrencyToken(selectedRecord),
      })

      startTransition(() => {
        setBootstrapData((current) => ({
          ...current,
          dbPath: result.dbPath,
          dbRevision: result.dbRevision,
          recordCount: result.recordCount,
        }))
        setStatusTone('success')
        setStatusMessage('Comment added successfully.')
        notifications.show({
          color: 'teal',
          title: 'Comment added',
          message: 'Comment has been saved to the record.',
          autoClose: 3000,
        })
      })

      await refreshRecords({ silent: true })
      await refreshAttachmentStorageStats({ silent: true })
      setCommentMessage('')
      setCommentAttachments([])
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to append the comment'

      if (isConcurrencyConflictMessage(message)) {
        await refreshRecords({ silent: true })
      }

      startTransition(() => {
        setStatusTone('error')
        setStatusMessage(message)
        notifications.show({
          color: 'red',
          title: 'Comment failed',
          message,
          autoClose: 6000,
        })
      })
    } finally {
      setIsSavingComment(false)
    }
  }

  function startEditingComment(comment: RecordComment) {
    setEditingCommentId(comment.id)
    setEditingCommentMessage(comment.message)
    setCommentError(null)
  }

  function cancelEditingComment() {
    setEditingCommentId(null)
    setEditingCommentMessage('')
    setCommentError(null)
  }

  async function handleSaveEditedComment(commentId: string) {
    if (!selectedRecord) {
      return
    }

    const message = editingCommentMessage.trim()
    if (message.length === 0) {
      setCommentError('Comment text is required.')
      return
    }

    setIsSavingComment(true)
    setCommentError(null)
    setStatusTone('info')
    setStatusMessage('Saving the edited comment...')

    try {
      const result = await updateActivityComment(selectedRecord.id, commentId, {
        message,
        expectedLastModifiedAt: recordConcurrencyToken(selectedRecord),
      })

      startTransition(() => {
        setBootstrapData((current) => ({
          ...current,
          dbPath: result.dbPath,
          dbRevision: result.dbRevision,
          recordCount: result.recordCount,
        }))
        setStatusTone('success')
        setStatusMessage('Comment updated.')
        notifications.show({
          color: 'teal',
          title: 'Comment updated',
          message: 'Your edit has been saved.',
          autoClose: 3000,
        })
      })

      await refreshRecords({ silent: true })
      setEditingCommentId(null)
      setEditingCommentMessage('')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to update the comment'

      if (isConcurrencyConflictMessage(message)) {
        await refreshRecords({ silent: true })
      }

      startTransition(() => {
        setStatusTone('error')
        setStatusMessage(message)
        notifications.show({
          color: 'red',
          title: 'Comment update failed',
          message,
          autoClose: 6000,
        })
      })
    } finally {
      setIsSavingComment(false)
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!selectedRecord) {
      return
    }

    const shouldDelete = window.confirm(
      'Delete this comment permanently from the selected record?',
    )
    if (!shouldDelete) {
      return
    }

    setIsDeletingCommentId(commentId)
    setCommentError(null)
    setStatusTone('info')
    setStatusMessage('Deleting the selected comment...')

    try {
      const result = await deleteActivityComment(
        selectedRecord.id,
        commentId,
        recordConcurrencyToken(selectedRecord),
      )

      startTransition(() => {
        setBootstrapData((current) => ({
          ...current,
          dbPath: result.dbPath,
          dbRevision: result.dbRevision,
          recordCount: result.recordCount,
        }))
        setStatusTone('success')
        setStatusMessage('Comment deleted.')
        notifications.show({
          color: 'teal',
          title: 'Comment deleted',
          message: 'The comment has been removed from the record.',
          autoClose: 3000,
        })
      })

      await refreshRecords({ silent: true })
      if (editingCommentId === commentId) {
        setEditingCommentId(null)
        setEditingCommentMessage('')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to delete the comment'

      if (isConcurrencyConflictMessage(message)) {
        await refreshRecords({ silent: true })
      }

      startTransition(() => {
        setStatusTone('error')
        setStatusMessage(message)
        notifications.show({
          color: 'red',
          title: 'Delete failed',
          message,
          autoClose: 6000,
        })
      })
    } finally {
      setIsDeletingCommentId(null)
    }
  }

  async function handleQuickUpdateRecord(
    record: ActivityRecord,
    payload: QuickUpdatePayload,
    successMessage: string,
  ) {
    setIsQuickSaving(true)
    setStatusTone('info')
    setStatusMessage('Saving the quick record update...')

    try {
      const result = await quickUpdateActivity(record.id, {
        ...payload,
        expectedLastModifiedAt: recordConcurrencyToken(record),
      })

      startTransition(() => {
        setBootstrapData((current) => ({
          ...current,
          dbPath: result.dbPath,
          dbRevision: result.dbRevision,
          recordCount: result.recordCount,
        }))
        setStatusTone('success')
        setStatusMessage(successMessage)
        notifications.show({
          color: 'teal',
          title: 'Record updated',
          message: successMessage,
          autoClose: 3000,
        })
      })

      await refreshRecords({ silent: true })
      await refreshStats({ silent: true })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save the quick update'

      if (isConcurrencyConflictMessage(message)) {
        await refreshRecords({ silent: true })
        await refreshStats({ silent: true })
      }

      startTransition(() => {
        setStatusTone('error')
        setStatusMessage(message)
        notifications.show({
          color: 'red',
          title: 'Update failed',
          message,
          autoClose: 6000,
        })
      })
    } finally {
      setIsQuickSaving(false)
    }
  }

  async function handleApplyQuickRecordChanges() {
    if (!selectedRecord) {
      return
    }

    await handleQuickUpdateRecord(
      selectedRecord,
      {
        owner: quickOwner,
        status: quickStatus,
        reminderCadence: quickReminderCadence,
      },
      'Record owner, status, or reminder settings updated successfully.',
    )
  }

  function handleSaveCurrentView() {
    const name = newSavedViewName.trim()
    if (!name) {
      return
    }

    const nextView: SavedView = {
      id: crypto.randomUUID(),
      name,
      filters: { ...sharedFilters },
    }

    setSavedViews((current) =>
      [...current.filter((entry) => entry.name !== name), nextView].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    )
    setSelectedSavedViewId(nextView.id)
    setNewSavedViewName('')
  }

  function handleApplySavedView(viewId: string | null) {
    setSelectedSavedViewId(viewId)
    if (!viewId) {
      return
    }

    const nextView = savedViews.find((entry) => entry.id === viewId)
    if (nextView) {
      setSharedFilters({ ...emptySharedFilters, ...nextView.filters })
    }
  }

  function handleDeleteSavedView() {
    if (!selectedSavedViewId) {
      return
    }

    setSavedViews((current) =>
      current.filter((entry) => entry.id !== selectedSavedViewId),
    )
    setSelectedSavedViewId(null)
  }

  async function persistSettingsChange(
    payload: TrackerSettings,
    options?: {
      recordsOverride?: ActivityRecord[]
    },
  ) {
    const isReplacingRecords = Boolean(options?.recordsOverride)

    setIsSavingSettings(true)
    setSettingsError(null)
    setSettingsConflictError(null)
    setStatusTone('info')
    setStatusMessage(
      isReplacingRecords
        ? 'Saving tracker admin settings and replacing existing record labels...'
        : 'Saving tracker admin settings into the database...',
    )

    try {
      const result = isReplacingRecords
        ? await replaceDatabaseRecords(options?.recordsOverride ?? records, payload)
        : await updateTrackerSettings(payload, bootstrapData.dbRevision)

      startTransition(() => {
        setBootstrapData((current) => ({
          ...current,
          ...payload,
          dbPath: result.dbPath,
          dbRevision: result.dbRevision,
          recordCount: result.recordCount,
        }))
        setImportExportMessage(
          result.backupPath
            ? isReplacingRecords
              ? `Tracker settings saved and in-use values were replaced. Backup saved to ${result.backupPath}.`
              : `Tracker settings saved. Backup saved to ${result.backupPath}.`
            : isReplacingRecords
              ? 'Tracker settings saved and in-use values were replaced.'
              : 'Tracker settings saved.',
        )
        setStatusTone('success')
        setStatusMessage(
          result.backupPath
            ? isReplacingRecords
              ? `Admin settings were saved, existing records were relabeled, and a backup was created at ${result.backupPath}.`
              : `Admin settings were saved. A backup was created at ${result.backupPath}.`
            : isReplacingRecords
              ? 'Admin settings were saved and existing records were relabeled.'
              : 'Admin settings were saved.',
        )
      })

      setPendingSettingsPayload(null)
      setSettingsConflicts([])
      await refreshRecords({ silent: true })
      await refreshStats({ silent: true })
      await refreshBackups({ silent: true })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save tracker settings'
      setSettingsError(message)
      setStatusTone('error')
      setStatusMessage(message)
    } finally {
      setIsSavingSettings(false)
    }
  }

  function buildSettingsPayload() {
    const reminderCadences = parseReminderCadenceLines(reminderCadencesDraft)
    const invalidReminderCadence = reminderCadences.find(
      (entry) => entry.label.trim().length === 0 || Number.isNaN(entry.intervalDays),
    )

    if (invalidReminderCadence) {
      setSettingsError(
        'Reminder cadences must use the format "Label | days", for example "Weekly | 7".',
      )
      return null
    }

    const categories = uniqueTrimmedLines(categoriesDraft)

    return {
      owners: uniqueTrimmedLines(ownersDraft),
      projects: uniqueTrimmedLines(projectsDraft),
      departments: uniqueTrimmedLines(departmentsDraft),
      categories,
      categoryImpactFactors: normalizeCategoryImpactFactors(
        categories,
        categoryImpactFactorsDraft,
      ),
      priorities: uniqueTrimmedLines(prioritiesDraft),
      efforts: uniqueTrimmedLines(effortsDraft),
      impacts: uniqueTrimmedLines(impactsDraft),
      statuses: uniqueTrimmedLines(statusesDraft),
      reminderCadences,
    }
  }

  function discardConflictingSettingsRemovals() {
    const draftLinesByField = new Map<SettingsFieldKey, Set<string>>([
      ['owners', new Set(uniqueTrimmedLines(ownersDraft))],
      ['projects', new Set(uniqueTrimmedLines(projectsDraft))],
      ['departments', new Set(uniqueTrimmedLines(departmentsDraft))],
      ['categories', new Set(uniqueTrimmedLines(categoriesDraft))],
      ['priorities', new Set(uniqueTrimmedLines(prioritiesDraft))],
      ['efforts', new Set(uniqueTrimmedLines(effortsDraft))],
      ['impacts', new Set(uniqueTrimmedLines(impactsDraft))],
      ['statuses', new Set(uniqueTrimmedLines(statusesDraft))],
      ['reminderCadences', new Set(uniqueTrimmedLines(reminderCadencesDraft))],
    ])

    for (const conflict of settingsConflicts) {
      draftLinesByField.get(conflict.field)?.add(conflict.removedDraftLine)
    }

    setOwnersDraft(Array.from(draftLinesByField.get('owners') ?? []).join('\n'))
    setProjectsDraft(Array.from(draftLinesByField.get('projects') ?? []).join('\n'))
    setDepartmentsDraft(Array.from(draftLinesByField.get('departments') ?? []).join('\n'))
    const restoredCategories = Array.from(draftLinesByField.get('categories') ?? [])
    setCategoriesDraft(restoredCategories.join('\n'))
    setCategoryImpactFactorsDraft((current) =>
      normalizeCategoryImpactFactors(restoredCategories, current),
    )
    setPrioritiesDraft(Array.from(draftLinesByField.get('priorities') ?? []).join('\n'))
    setEffortsDraft(Array.from(draftLinesByField.get('efforts') ?? []).join('\n'))
    setImpactsDraft(Array.from(draftLinesByField.get('impacts') ?? []).join('\n'))
    setStatusesDraft(Array.from(draftLinesByField.get('statuses') ?? []).join('\n'))
    setReminderCadencesDraft(
      Array.from(draftLinesByField.get('reminderCadences') ?? []).join('\n'),
    )
    setPendingSettingsPayload(null)
    setSettingsConflicts([])
    setSettingsConflictError(null)
    setSettingsError(
      'In-use values were restored to the draft. Choose replacements before removing them.',
    )
    setStatusTone('info')
    setStatusMessage('Conflicting removals were restored to the Admin draft.')
  }

  async function applySettingsConflictReplacements() {
    if (!pendingSettingsPayload) {
      return
    }

    const unresolvedConflict = settingsConflicts.find((conflict) => !conflict.replacement)
    if (unresolvedConflict) {
      setSettingsConflictError(
        `Choose a replacement for ${unresolvedConflict.fieldLabel.toLowerCase()} "${unresolvedConflict.removedValue}" before saving.`,
      )
      return
    }

    setSettingsConflictError(null)

    try {
      setIsSavingSettings(true)
      setStatusTone('info')
      setStatusMessage('Saving tracker admin settings and relabeling records atomically...')
      const replacements = settingsConflicts
        .filter((conflict) => conflict.replacement)
        .map((conflict) => ({
          field: conflict.field,
          from: conflict.removedValue,
          to: conflict.replacement ?? '',
        }))
      const result = await relabelTrackerSettings(
        pendingSettingsPayload,
        replacements,
        bootstrapData.dbRevision,
      )

      startTransition(() => {
        setBootstrapData((current) => ({
          ...current,
          ...pendingSettingsPayload,
          dbPath: result.dbPath,
          dbRevision: result.dbRevision,
          recordCount: result.recordCount,
        }))
        setImportExportMessage(
          result.backupPath
            ? `Tracker settings saved and in-use values were replaced. Backup saved to ${result.backupPath}.`
            : 'Tracker settings saved and in-use values were replaced.',
        )
        setStatusTone('success')
        setStatusMessage(
          result.backupPath
            ? `Admin settings were saved, existing records were relabeled atomically, and a backup was created at ${result.backupPath}.`
            : 'Admin settings were saved and existing records were relabeled atomically.',
        )
      })

      setPendingSettingsPayload(null)
      setSettingsConflicts([])
      await refreshRecords({ silent: true })
      await refreshStats({ silent: true })
      await refreshBackups({ silent: true })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to prepare replacement changes'
      setSettingsConflictError(message)
      setSettingsError(message)
      setStatusTone('error')
      setStatusMessage(message)
    } finally {
      setIsSavingSettings(false)
    }
  }

  async function handleSaveSettings() {
    const payload = buildSettingsPayload()
    if (!payload) {
      return
    }

    const conflicts = findSettingsUsageConflicts(trackerSettings, payload, records)
    if (conflicts.length > 0) {
      setPendingSettingsPayload(payload)
      setSettingsConflicts(conflicts)
      setSettingsConflictError(null)
      setSettingsError(null)
      return
    }

    await persistSettingsChange(payload)
  }

  function downloadTextFile(fileName: string, content: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function handleExportJson() {
    const document = buildDatabaseDocument(trackerSettings, records)

    downloadTextFile(
      `tracker-export-${dayjs().format('YYYY-MM-DD-HHmm')}.json`,
      JSON.stringify(document, null, 2),
      'application/json',
    )
    setImportExportMessage('Exported the current database and admin settings as JSON.')
  }

  function handleExportCsv() {
    const header = [
      'id',
      'title',
      'owner',
      'status',
      'priority',
      'reminderCadence',
      'startDate',
      'endDate',
      'projects',
      'departments',
      'categories',
      'comments',
      'attachments',
      'lastModifiedAt',
    ]
    const rows = records.map((record) =>
      [
        record.id,
        record.title,
        record.owner,
        record.status,
        record.priority,
        record.reminderCadence,
        record.startDate,
        record.endDate,
        record.projects.join(' | '),
        record.departments.join(' | '),
        record.categories.join(' | '),
        String(record.comments.length),
        String(record.attachments.length),
        record.lastModifiedAt || record.submittedAt,
      ]
        .map((value) => `"${value.replaceAll('"', '""')}"`)
        .join(','),
    )

    downloadTextFile(
      `tracker-export-${dayjs().format('YYYY-MM-DD-HHmm')}.csv`,
      [header.join(','), ...rows].join('\n'),
      'text/csv',
    )
    setImportExportMessage('Exported the current database as CSV.')
  }

  async function handleImportJson(file: File) {
    try {
      const shouldReplace = window.confirm(
        'Replace the current tracker database with the records from this JSON file?',
      )
      if (!shouldReplace) {
        return
      }

      const content = await file.text()
      const parsed = JSON.parse(content)
      const importDocument = Array.isArray(parsed)
        ? { records: parsed as ActivityRecord[], settings: undefined }
        : typeof parsed === 'object' &&
            parsed !== null &&
            Array.isArray((parsed as DatabaseDocument).records) &&
            typeof (parsed as DatabaseDocument).settings === 'object' &&
            (parsed as DatabaseDocument).settings !== null
          ? {
              records: (parsed as DatabaseDocument).records,
              settings: (parsed as DatabaseDocument).settings,
            }
          : null

      if (!importDocument) {
        throw new Error('Expected a JSON record array or a tracker database document.')
      }

      const result = await replaceDatabaseRecords(
        importDocument.records,
        importDocument.settings,
      )
      startTransition(() => {
        setBootstrapData((current) => ({
          ...current,
          ...(importDocument.settings ?? {}),
          dbPath: result.dbPath,
          dbRevision: result.dbRevision,
          recordCount: result.recordCount,
        }))
        setImportExportMessage(
          result.backupPath
            ? `Imported ${importDocument.records.length} records from JSON. Backup saved to ${result.backupPath}.`
            : `Imported ${importDocument.records.length} records from JSON.`,
        )
        setStatusTone('success')
        setStatusMessage(
          result.backupPath
            ? `The tracker database was replaced from the selected JSON file. A backup was created at ${result.backupPath}.`
            : 'The tracker database was replaced from the selected JSON file.',
        )
      })

      await refreshRecords({ silent: true })
      await refreshStats({ silent: true })
      await refreshBackups({ silent: true })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to import the JSON file'
      setImportExportMessage(message)
      setStatusTone('error')
      setStatusMessage(message)
    }
  }

  async function handleRestoreBackup(backup: DatabaseBackup) {
    const shouldRestore = window.confirm(
      `Restore the tracker database from backup "${backup.fileName}"? The current database will be backed up first.`,
    )
    if (!shouldRestore) {
      return
    }

    setIsRestoringBackupPath(backup.path)
    setStatusTone('info')
    setStatusMessage(`Restoring the tracker database from backup "${backup.fileName}"...`)

    try {
      const result = await restoreDatabaseBackup(backup.path)
      startTransition(() => {
        setBootstrapData((current) => ({
          ...current,
          dbPath: result.dbPath,
          dbRevision: result.dbRevision,
          recordCount: result.recordCount,
        }))
        setImportExportMessage(
          result.backupPath
            ? `Restored ${backup.fileName}. The previous database snapshot was saved to ${result.backupPath}.`
            : `Restored ${backup.fileName}.`,
        )
        setStatusTone('success')
        setStatusMessage(
          result.backupPath
            ? `Backup ${backup.fileName} is now live. The previous database was backed up to ${result.backupPath}.`
            : `Backup ${backup.fileName} is now live.`,
        )
      })

      await refreshRecords({ silent: true })
      await refreshStats({ silent: true })
      await refreshBackups({ silent: true })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to restore the selected backup'
      setImportExportMessage(message)
      setStatusTone('error')
      setStatusMessage(message)
    } finally {
      setIsRestoringBackupPath(null)
    }
  }

  async function handleCopyWeeklyReport() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(weeklyReportText)
      } else {
        const helper = document.createElement('textarea')
        helper.value = weeklyReportText
        helper.setAttribute('readonly', 'true')
        helper.style.position = 'absolute'
        helper.style.left = '-9999px'
        document.body.appendChild(helper)
        helper.select()
        document.execCommand('copy')
        helper.remove()
      }

      setWeeklyCopyState('success')
    } catch {
      setWeeklyCopyState('error')
    }
  }

  function buildAttachmentKey(
    recordId: string,
    attachment: AttachmentPayload,
    commentId?: string | null,
  ) {
    return `${recordId}:${commentId ?? 'record'}:${attachment.id}`
  }

  async function loadAttachmentData(
    recordId: string,
    attachment: AttachmentPayload,
    commentId?: string | null,
  ) {
    const key = buildAttachmentKey(recordId, attachment, commentId)
    const cached = previewAttachmentDataByKey[key]
    if (cached) {
      return cached
    }

    if (attachment.base64Data) {
      const inlineData: AttachmentData = {
        ...attachment,
        base64Data: attachment.base64Data,
      }
      setPreviewAttachmentDataByKey((current) => ({
        ...current,
        [key]: inlineData,
      }))
      return inlineData
    }

    setLoadingAttachmentKey(key)
    try {
      const data = await readAttachmentData(recordId, attachment.id, commentId)
      setPreviewAttachmentDataByKey((current) => ({
        ...current,
        [key]: data,
      }))
      setRefreshErrors((current) => ({ ...current, attachments: undefined }))
      return data
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to read attachment data'
      setRefreshErrors((current) => ({ ...current, attachments: message }))
      setStatusTone('error')
      setStatusMessage(message)
      throw error
    } finally {
      setLoadingAttachmentKey((current) => (current === key ? null : current))
    }
  }

  async function toggleAttachmentPreview(
    recordId: string,
    attachment: AttachmentPayload,
    commentId?: string | null,
  ) {
    const key = buildAttachmentKey(recordId, attachment, commentId)
    if (previewAttachmentKey === key) {
      setPreviewAttachmentKey(null)
      return
    }

    setPreviewAttachmentKey(key)
    await loadAttachmentData(recordId, attachment, commentId)
  }

  async function handleDownloadAttachment(
    recordId: string,
    attachment: AttachmentPayload,
    commentId?: string | null,
  ) {
    const data = await loadAttachmentData(recordId, attachment, commentId)
    downloadAttachment(data)
  }

  const previewPayload = {
    title: form.values.title.trim(),
    owner: form.values.owner,
    projects: form.values.projects,
    startDate: formatDate(form.values.startDate),
    endDate: formatDate(form.values.endDate),
    departments: form.values.departments,
    description: form.values.description.trim(),
    effort: form.values.effort,
    impact: form.values.impact,
    priority: form.values.priority,
    status: form.values.status,
    reminderCadence: form.values.reminderCadence,
    categories: form.values.categories,
    attachments: form.values.attachments.map((attachment) => ({
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    })),
  }

  const statusIcon =
    statusTone === 'success' ? (
      <IconCircleCheck size={18} />
    ) : statusTone === 'error' ? (
      <IconAlertCircle size={18} />
    ) : (
      <IconDatabase size={18} />
    )

  const statusColor =
    statusTone === 'success' ? 'teal' : statusTone === 'error' ? 'red' : 'blue'

  return (
    <div className="app-shell">
      <Modal
        opened={settingsConflicts.length > 0}
        onClose={discardConflictingSettingsRemovals}
        title="Resolve in-use Admin values"
        centered
        size="xl"
        closeOnClickOutside={false}
        closeOnEscape={false}
        withCloseButton={false}
      >
        <Stack gap="md">
          <Alert color="yellow" icon={<IconAlertCircle size={18} />}>
            One or more values you removed are still used by existing records. Choose a
            replacement for each one, or discard the removal and keep the current labels.
          </Alert>

          {settingsConflictError ? (
            <Text size="sm" c="red">
              {settingsConflictError}
            </Text>
          ) : null}

          {settingsConflicts.map((conflict, index) => (
            <Card key={`${conflict.field}-${conflict.removedValue}`} withBorder radius="lg">
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text fw={700}>
                      {conflict.fieldLabel}: {conflict.removedValue}
                    </Text>
                    <Text size="sm" c="dimmed">
                      Used in {conflict.usages.length} record
                      {conflict.usages.length === 1 ? '' : 's'}
                    </Text>
                  </div>
                  <Badge variant="light" color="yellow">
                    In use
                  </Badge>
                </Group>

                <Select
                  label={`Replace "${conflict.removedValue}" with`}
                  placeholder={
                    conflict.replacementOptions.length === 0
                      ? `Add a new ${conflict.fieldLabel.toLowerCase()} first`
                      : `Choose a new ${conflict.fieldLabel.toLowerCase()}`
                  }
                  data={conflict.replacementOptions}
                  value={conflict.replacement}
                  onChange={(value) =>
                    setSettingsConflicts((current) =>
                      current.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, replacement: value } : entry,
                      ),
                    )
                  }
                  disabled={conflict.replacementOptions.length === 0 || isSavingSettings}
                />

                <Stack gap={4}>
                  <Text size="sm" fw={600}>
                    Used in
                  </Text>
                  {conflict.usages.map((usage) => (
                    <Text key={`${conflict.field}-${conflict.removedValue}-${usage.recordId}`} size="sm" c="dimmed">
                      {usage.title} ({formatRecordKey(usage.recordId)})
                    </Text>
                  ))}
                </Stack>
              </Stack>
            </Card>
          ))}

          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={discardConflictingSettingsRemovals}
              disabled={isSavingSettings}
            >
              Discard removal
            </Button>
            <Button
              color="blue"
              onClick={() => void applySettingsConflictReplacements()}
              loading={isSavingSettings}
            >
              Replace and save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
        title="Keyboard shortcuts"
        centered
        size="md"
      >
        <Stack gap="md">
          <div className="shortcut-list">
            <Text size="sm" fw={700} c="dimmed" mb={4}>Navigation</Text>
            <div className="shortcut-row">
              <Text size="sm" c="dimmed">Switch pages</Text>
              <span className="kbd-group">
                {orderedPages.map((page) => (
                  <kbd className="kbd-hint" key={page}>{pageShortcutMap[page]}</kbd>
                ))}
              </span>
            </div>
            <div className="shortcut-row">
              <Text size="sm" c="dimmed">Open shortcuts help</Text>
              <kbd className="kbd-hint">?</kbd>
            </div>
            <Text size="sm" fw={700} c="dimmed" mt="sm" mb={4}>Records page</Text>
            <div className="shortcut-row">
              <Text size="sm" c="dimmed">Next record</Text>
              <span className="kbd-group">
                <kbd className="kbd-hint">J</kbd>
                <kbd className="kbd-hint">↓</kbd>
              </span>
            </div>
            <div className="shortcut-row">
              <Text size="sm" c="dimmed">Previous record</Text>
              <span className="kbd-group">
                <kbd className="kbd-hint">K</kbd>
                <kbd className="kbd-hint">↑</kbd>
              </span>
            </div>
            <div className="shortcut-row">
              <Text size="sm" c="dimmed">Edit selected record</Text>
              <kbd className="kbd-hint">E</kbd>
            </div>
          </div>
        </Stack>
      </Modal>

      <div
        className={`workspace-grid ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      >
        <Paper
          radius="xl"
          p="xl"
          className={`sidebar-panel ${isSidebarCollapsed ? 'collapsed' : ''}`}
        >
          <Stack gap="xl" className="sidebar-stack">
            <div className="sidebar-topbar">
              {!isSidebarCollapsed ? (
                <div>
                  <Text className="eyebrow">Tracker</Text>
                  <Title order={1} className="hero-title">
                    Shared issue tracking for team operations.
                  </Title>
                  <Text mt="md" className="hero-copy">
                    Work items, reports, boards, and administration in one compact desktop view.
                  </Text>
                </div>
              ) : (
                <Text className="eyebrow">TRK</Text>
              )}

              <button
                type="button"
                className="sidebar-toggle"
                aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={() => setIsSidebarCollapsed((current) => !current)}
              >
                {isSidebarCollapsed ? '>' : '<'}
              </button>
            </div>

            <div className="page-nav">
              <Tooltip label="Overview — Workspace summary" position="right" disabled={!isSidebarCollapsed}>
                <button
                  type="button"
                  className={`page-link ${currentPage === 'overview' ? 'active' : ''}`}
                  onClick={() => setCurrentPage('overview')}
                >
                  <span className="page-link-icon">
                    <IconLayoutDashboard size={18} />
                  </span>
                  <span>
                    <strong>Overview</strong>
                    <small>Workspace summary</small>
                  </span>
                  <span className="page-link-shortcut">1</span>
                </button>
              </Tooltip>

              <Tooltip label="Tracker Form — Capture new work" position="right" disabled={!isSidebarCollapsed}>
                <button
                  type="button"
                  className={`page-link ${currentPage === 'form' ? 'active' : ''}`}
                  onClick={() => setCurrentPage('form')}
                >
                  <span className="page-link-icon">
                    <IconClipboardText size={18} />
                  </span>
                  <span>
                    <strong>Tracker Form</strong>
                    <small>Capture new work</small>
                  </span>
                  <span className="page-link-shortcut">2</span>
                </button>
              </Tooltip>

              <Tooltip label="Records — Browse saved work" position="right" disabled={!isSidebarCollapsed}>
                <button
                  type="button"
                  className={`page-link ${currentPage === 'records' ? 'active' : ''}`}
                  onClick={() => setCurrentPage('records')}
                >
                  <span className="page-link-icon" style={{ position: 'relative' }}>
                    <IconListDetails size={18} />
                    {overdueCount + staleCount + reminderDueCount > 0 ? (
                      <span className="nav-signal-dot" />
                    ) : null}
                  </span>
                  <span>
                    <strong>Records</strong>
                    <small>Browse saved work</small>
                  </span>
                  {overdueCount + staleCount + reminderDueCount > 0 && !isSidebarCollapsed ? (
                    <Badge size="xs" variant="filled" color="red" radius="xl" className="page-link-shortcut">
                      {overdueCount + staleCount + reminderDueCount}
                    </Badge>
                  ) : (
                    <span className="page-link-shortcut">3</span>
                  )}
                </button>
              </Tooltip>

              <Tooltip label="Board — Kanban by status" position="right" disabled={!isSidebarCollapsed}>
                <button
                  type="button"
                  className={`page-link ${currentPage === 'board' ? 'active' : ''}`}
                  onClick={() => setCurrentPage('board')}
                >
                  <span className="page-link-icon">
                    <IconLayoutKanban size={18} />
                  </span>
                  <span>
                    <strong>Board</strong>
                    <small>Kanban by status</small>
                  </span>
                  <span className="page-link-shortcut">4</span>
                </button>
              </Tooltip>

              <Tooltip label="Insights — Charts and trends" position="right" disabled={!isSidebarCollapsed}>
                <button
                  type="button"
                  className={`page-link ${currentPage === 'insights' ? 'active' : ''}`}
                  onClick={() => setCurrentPage('insights')}
                >
                  <span className="page-link-icon">
                    <IconChartBar size={18} />
                  </span>
                  <span>
                    <strong>Insights</strong>
                    <small>Charts and trends</small>
                  </span>
                  <span className="page-link-shortcut">5</span>
                </button>
              </Tooltip>

              <Tooltip label="Weekly — Email-ready report" position="right" disabled={!isSidebarCollapsed}>
                <button
                  type="button"
                  className={`page-link ${currentPage === 'weekly' ? 'active' : ''}`}
                  onClick={() => setCurrentPage('weekly')}
                >
                  <span className="page-link-icon">
                    <IconClipboardText size={18} />
                  </span>
                  <span>
                    <strong>Weekly</strong>
                    <small>Email-ready report</small>
                  </span>
                  <span className="page-link-shortcut">6</span>
                </button>
              </Tooltip>

              <Tooltip label="Admin — Manage tracker settings" position="right" disabled={!isSidebarCollapsed}>
                <button
                  type="button"
                  className={`page-link ${currentPage === 'admin' ? 'active' : ''}`}
                  onClick={() => setCurrentPage('admin')}
                >
                  <span className="page-link-icon">
                    <IconFolders size={18} />
                  </span>
                  <span>
                    <strong>Admin</strong>
                    <small>Manage tracker settings</small>
                  </span>
                  <span className="page-link-shortcut">7</span>
                </button>
              </Tooltip>
            </div>

            {!isSidebarCollapsed ? (
              <>
                <Alert
                  color={statusColor}
                  variant="light"
                  radius="lg"
                  icon={statusIcon}
                  title="Tracker status"
                  className="status-card"
                >
                  {isBootstrapping ? 'Preparing the application...' : statusMessage}
                </Alert>

                {activeRefreshErrors.length > 0 ? (
                  <Alert
                    color="yellow"
                    variant="light"
                    radius="lg"
                    icon={<IconAlertCircle size={18} />}
                    title="Some data could not be refreshed"
                    className="status-card"
                  >
                    <Stack gap={4}>
                      {activeRefreshErrors.map(([area, message]) => (
                        <Text size="sm" key={area}>
                          {area}: {message}
                        </Text>
                      ))}
                    </Stack>
                  </Alert>
                ) : null}

                <div className="metric-row">
                  <div className="metric-tile">
                    <span className="metric-label">Records</span>
                    <span className="metric-value">{stats.recordCount}</span>
                  </div>
                  <div className="metric-tile">
                    <span className="metric-label">Owners</span>
                    <span className="metric-value">{bootstrapData.owners.length}</span>
                  </div>
                  <div className="metric-tile">
                    <span className="metric-label">Projects</span>
                    <span className="metric-value">{bootstrapData.projects.length}</span>
                  </div>
                  <div className="metric-tile">
                    <span className="metric-label">Avg Duration</span>
                    <span className="metric-value">{stats.averageDurationDays}d</span>
                  </div>
                </div>

                <Card radius="xl" padding="lg" className="surface-card">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <IconDatabase size={18} />
                        <Text fw={700}>Database target</Text>
                      </Group>
                      <Badge variant="light" color="blue">
                        JSON
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed">
                      Override with <code>TRACKER_DB_PATH</code> for a shared Mac or
                      Windows deployment.
                    </Text>
                    <Text size="sm" fw={600} className="db-path">
                      {bootstrapData.dbPath}
                    </Text>
                  </Stack>
                </Card>

                <Card radius="xl" padding="lg" className="surface-card">
                  <Stack gap="sm">
                    <Text fw={700}>Shortcuts</Text>
                    <div className="shortcut-list">
                      <div className="shortcut-row">
                        <Text size="sm" c="dimmed">
                          Switch pages
                        </Text>
                        <span className="kbd-group">
                          {orderedPages.map((page) => (
                            <kbd className="kbd-hint" key={page}>
                              {pageShortcutMap[page]}
                            </kbd>
                          ))}
                        </span>
                      </div>
                      <div className="shortcut-row">
                        <Text size="sm" c="dimmed">
                          Move between records
                        </Text>
                        <span className="kbd-group">
                          <kbd className="kbd-hint">J</kbd>
                          <kbd className="kbd-hint">K</kbd>
                        </span>
                      </div>
                      <div className="shortcut-row">
                        <Text size="sm" c="dimmed">
                          Edit selected record
                        </Text>
                        <kbd className="kbd-hint">E</kbd>
                      </div>
                    </div>
                  </Stack>
                </Card>
              </>
            ) : null}

            {!isSidebarCollapsed && currentPage === 'insights' ? (
              <Card radius="xl" padding="lg" className="surface-card">
                <Stack gap="sm">
                  <Group gap="xs">
                    <IconChartBar size={18} />
                    <Text fw={700}>Insight scope</Text>
                  </Group>
                  <Text fw={700}>
                    {filteredInsightRecords.length} record
                    {filteredInsightRecords.length === 1 ? '' : 's'}
                  </Text>
                  <Text size="sm" c="dimmed">
                    Avg duration {formatMetricNumber(insightAverageDuration)} days
                    {' · '}
                    High priority {formatMetricNumber(insightHighPriorityShare)}%
                  </Text>
                  <Text size="sm" c="dimmed">
                    {hasActiveFilters
                      ? 'Charts below are narrowed by the active filters.'
                      : 'Charts below reflect the full shared database.'}
                  </Text>
                </Stack>
              </Card>
            ) : !isSidebarCollapsed && currentPage === 'form' ? (
              <Card radius="xl" padding="lg" className="surface-card">
                <Stack gap="sm">
                  <Group gap="xs">
                    <IconClipboardText size={18} />
                    <Text fw={700}>Payload preview</Text>
                  </Group>
                  <pre className="json-preview">
                    {JSON.stringify(previewPayload, null, 2)}
                  </pre>
                </Stack>
              </Card>
            ) : !isSidebarCollapsed && currentPage === 'board' ? (
              <Card radius="xl" padding="lg" className="surface-card">
                <Stack gap="sm">
                  <Group gap="xs">
                    <IconLayoutKanban size={18} />
                    <Text fw={700}>Board scope</Text>
                  </Group>
                  <Text fw={700}>
                    {filteredRecords.length} tracked record
                    {filteredRecords.length === 1 ? '' : 's'}
                  </Text>
                  <Text size="sm" c="dimmed">
                    Status columns reflect the shared workspace filters.
                    {completedStatusLabel
                      ? showCompletedColumn
                        ? ` ${completedStatusLabel} is currently visible.`
                        : ` ${completedStatusLabel} is currently hidden.`
                      : ''}
                  </Text>
                </Stack>
              </Card>
            ) : !isSidebarCollapsed && currentPage === 'weekly' ? (
              <Card radius="xl" padding="lg" className="surface-card">
                <Stack gap="sm">
                  <Group gap="xs">
                    <IconClipboardText size={18} />
                    <Text fw={700}>Weekly scope</Text>
                  </Group>
                  <Text fw={700}>
                    {weeklyReportEntries.length} activit
                    {weeklyReportEntries.length === 1 ? 'y' : 'ies'}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {weeklyIncludedCommentCount} comment
                    {weeklyIncludedCommentCount === 1 ? '' : 's'} in{' '}
                    {weeklyReportMode === 'week'
                      ? `CWK ${selectedWeeklyWeek} ${selectedWeeklyYear}`
                      : 'the selected range'}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {weeklyReportMode === 'week' ? 'ISO week window' : 'Custom range'}:{' '}
                    {weeklyRangeLabel}
                  </Text>
                </Stack>
              </Card>
            ) : !isSidebarCollapsed && currentPage === 'records' && selectedRecord ? (
              <Card radius="xl" padding="lg" className="surface-card">
                <Stack gap="sm">
                  <Group gap="xs">
                    <IconFileDescription size={18} />
                    <Text fw={700}>Selected item</Text>
                  </Group>
                  <Text fw={700}>{selectedRecord.title}</Text>
                  <Text size="sm" c="dimmed">
                    {formatRecordKey(selectedRecord.id)} · {selectedRecord.owner} ·{' '}
                    {selectedRecord.status} · {selectedRecord.priority} priority
                  </Text>
                  <Badge variant="light" color={activityStatusColor(selectedRecord.status)} w="fit-content">
                    {selectedRecord.status}
                  </Badge>
                  <Text size="sm" c="dimmed">
                    Saved {formatTimestamp(selectedRecord.submittedAt)}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {selectedRecord.attachments.length} attachment
                    {selectedRecord.attachments.length === 1 ? '' : 's'}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {selectedRecord.comments.length} comment
                    {selectedRecord.comments.length === 1 ? '' : 's'}
                  </Text>
                </Stack>
              </Card>
            ) : null}

            <div className="sidebar-spacer" />

            {isSidebarCollapsed ? (
              <>
                <Tooltip label="Keyboard shortcuts (?)" position="right">
                  <Button
                    variant="default"
                    className="theme-toggle-button"
                    onClick={() => setIsShortcutsModalOpen(true)}
                    aria-label="Show keyboard shortcuts"
                  >
                    <IconHelp size={18} />
                  </Button>
                </Tooltip>
                <Button
                  variant="default"
                  className="theme-toggle-button"
                  onClick={() =>
                    setColorScheme(activeColorScheme === 'dark' ? 'light' : 'dark')
                  }
                  aria-label={
                    activeColorScheme === 'dark'
                      ? 'Switch to light theme'
                      : 'Switch to dark theme'
                  }
                >
                  {activeColorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
                </Button>
              </>
            ) : (
              <Card radius="xl" padding="lg" className="surface-card theme-switcher-card">
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <div>
                      <Text fw={700}>Appearance</Text>
                      <Text size="sm" c="dimmed">
                        Switch the whole workspace between light and dark.
                      </Text>
                    </div>
                    <ThemeIcon variant="light" color="blue" radius="xl" size="lg">
                      {activeColorScheme === 'dark' ? (
                        <IconMoon size={18} />
                      ) : (
                        <IconSun size={18} />
                      )}
                    </ThemeIcon>
                  </Group>

                  <SegmentedControl
                    fullWidth
                    value={activeColorScheme}
                    onChange={(value) => setColorScheme(value as 'light' | 'dark')}
                    data={[
                      { label: 'Light', value: 'light' },
                      { label: 'Dark', value: 'dark' },
                    ]}
                  />
                </Stack>
              </Card>
            )}
          </Stack>
        </Paper>

        <Paper radius="xl" p="xl" className="content-panel">
          {currentPage !== 'form' && currentPage !== 'admin' ? (
            <Card radius="xl" padding="lg" className="surface-card common-filter-card">
              <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text fw={700}>Workspace filters</Text>
                    <Text size="sm" c="dimmed">
                      Shared across overview, records, board, insights, and weekly.
                    </Text>
                  </div>
                  <Group gap="sm">
                    <Badge variant="light" color={hasActiveFilters ? 'blue' : 'gray'}>
                      {filteredRecords.length} match
                      {filteredRecords.length === 1 ? '' : 'es'}
                    </Badge>
                    <Badge variant="light" color={hasActiveFilters ? 'indigo' : 'gray'}>
                      {activeFilterGroups.length} active
                    </Badge>
                    {hasActiveFilters ? (
                      <Button
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        onClick={() => {
                          setSharedFilters({ ...emptySharedFilters })
                          setSelectedSavedViewId(null)
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : null}
                    <Button
                      variant="default"
                      color="gray"
                      radius="xl"
                      leftSection={
                        isFiltersCollapsed ? (
                          <IconChevronDown size={16} />
                        ) : (
                          <IconChevronUp size={16} />
                        )
                      }
                      onClick={() =>
                        setIsFiltersCollapsed((current) => !current)
                      }
                    >
                      {isFiltersCollapsed ? 'Show filters' : 'Hide filters'}
                    </Button>
                  </Group>
                </Group>

                <Text size="sm" c="dimmed" className="filter-summary">
                  {activeFilterSummary}
                </Text>

                {!isFiltersCollapsed ? (
                  <Stack gap="md">
                    <div className="filter-toolbar-grid">
                      <TextInput
                        label="Search"
                        placeholder="Search title, description, comments, owner, project..."
                        value={sharedFilters.searchTerm}
                        onChange={(event) =>
                          setSharedFilters((current) => ({
                            ...current,
                            searchTerm: event.currentTarget.value,
                          }))
                        }
                      />
                      <Select
                        label="Saved view"
                        placeholder="Load a saved filter view"
                        data={savedViews.map((view) => ({
                          value: view.id,
                          label: view.name,
                        }))}
                        value={selectedSavedViewId}
                        onChange={handleApplySavedView}
                        clearable
                      />
                      <TextInput
                        label="Save current view"
                        placeholder="Name this filter preset"
                        value={newSavedViewName}
                        onChange={(event) => setNewSavedViewName(event.currentTarget.value)}
                      />
                      <div className="filter-toolbar-actions">
                        <Button
                          variant="light"
                          color="blue"
                          radius="xl"
                          onClick={handleSaveCurrentView}
                          disabled={newSavedViewName.trim().length === 0}
                        >
                          Save view
                        </Button>
                        <Button
                          variant="subtle"
                          color="gray"
                          radius="xl"
                          onClick={handleDeleteSavedView}
                          disabled={!selectedSavedViewId}
                        >
                          Delete view
                        </Button>
                      </div>
                    </div>

                    <div className="filter-grid-wide">
                      <MultiSelect
                        label="Owner"
                        placeholder="Any owner"
                        data={bootstrapData.owners}
                        searchable
                        hidePickedOptions
                        value={sharedFilters.owners}
                        onChange={(owners) =>
                          setSharedFilters((current) => ({ ...current, owners }))
                        }
                      />
                      <MultiSelect
                        label="Project"
                        placeholder="Any project"
                        data={bootstrapData.projects}
                        searchable
                        hidePickedOptions
                        value={sharedFilters.projects}
                        onChange={(projects) =>
                          setSharedFilters((current) => ({ ...current, projects }))
                        }
                      />
                      <MultiSelect
                        label="Department"
                        placeholder="Any department"
                        data={bootstrapData.departments}
                        searchable
                        hidePickedOptions
                        value={sharedFilters.departments}
                        onChange={(departments) =>
                          setSharedFilters((current) => ({ ...current, departments }))
                        }
                      />
                      <MultiSelect
                        label="Category"
                        placeholder="Any category"
                        data={bootstrapData.categories}
                        searchable
                        hidePickedOptions
                        value={sharedFilters.categories}
                        onChange={(categories) =>
                          setSharedFilters((current) => ({ ...current, categories }))
                        }
                      />
                      <MultiSelect
                        label="Status"
                        placeholder="Any status"
                        data={trackerStatusOptions}
                        searchable
                        hidePickedOptions
                        value={sharedFilters.statuses}
                        onChange={(statuses) =>
                          setSharedFilters((current) => ({
                            ...current,
                            statuses: statuses as ActivityStatus[],
                          }))
                        }
                      />
                      <MultiSelect
                        label="Priority"
                        placeholder="Any priority"
                        data={priorityOptions}
                        searchable
                        hidePickedOptions
                        value={sharedFilters.priorities}
                        onChange={(priorities) =>
                          setSharedFilters((current) => ({ ...current, priorities }))
                        }
                      />
                      <MultiSelect
                        label="Effort"
                        placeholder="Any effort"
                        data={effortOptions}
                        searchable
                        hidePickedOptions
                        value={sharedFilters.efforts}
                        onChange={(efforts) =>
                          setSharedFilters((current) => ({ ...current, efforts }))
                        }
                      />
                      <MultiSelect
                        label="Impact"
                        placeholder="Any impact"
                        data={impactOptions}
                        searchable
                        hidePickedOptions
                        value={sharedFilters.impacts}
                        onChange={(impacts) =>
                          setSharedFilters((current) => ({ ...current, impacts }))
                        }
                      />
                    </div>
                  </Stack>
                ) : null}
              </Stack>
            </Card>
          ) : null}

          {currentPage === 'overview' ? (
            <Stack gap="lg">
              <div className="section-header">
                <div>
                  <Text className="eyebrow">Overview</Text>
                  <Title order={2} className="form-title">
                    Database overview
                  </Title>
                  <Text className="form-copy">
                    A quick read on how the shared tracker database is evolving
                    across owners, projects, effort, impact, and priority.
                  </Text>
                </div>

                <Group gap="sm">
                  <Button
                    variant="light"
                    color="blue"
                    radius="xl"
                    onClick={() => void refreshStats()}
                    loading={isRefreshingStats}
                    disabled={isBootstrapping}
                  >
                    Refresh stats
                  </Button>
                </Group>
              </div>

              <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="md">
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Latest submission</Text>
                  <Text className="insight-value">
                    {formatTimestamp(stats.latestSubmittedAt)}
                  </Text>
                </Card>
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Next ending activity</Text>
                  <Text className="insight-value">
                    {formatShortDate(stats.upcomingEndDate)}
                  </Text>
                </Card>
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Unique departments</Text>
                  <Text className="insight-value">{stats.uniqueDepartments}</Text>
                </Card>
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Unique categories</Text>
                  <Text className="insight-value">{stats.uniqueCategories}</Text>
                </Card>
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="md">
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Overdue</Text>
                  <Text className="insight-value">{overdueCount}</Text>
                </Card>
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Due Soon</Text>
                  <Text className="insight-value">{dueSoonCount}</Text>
                </Card>
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Stale</Text>
                  <Text className="insight-value">{staleCount}</Text>
                </Card>
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Reminder Due</Text>
                  <Text className="insight-value">{reminderDueCount}</Text>
                </Card>
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, xl: 3 }} spacing="md">
                <DistributionCard
                  title="Priority mix"
                  icon={<IconTargetArrow size={18} />}
                  buckets={stats.priorityCounts}
                />
                <DistributionCard
                  title="Effort mix"
                  icon={<IconChartBar size={18} />}
                  buckets={stats.effortCounts}
                />
                <DistributionCard
                  title="Impact mix"
                  icon={<IconDatabase size={18} />}
                  buckets={stats.impactCounts}
                />
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                <RankingCard
                  title="Top owners"
                  caption="Most represented owners in the database"
                  buckets={stats.topOwners}
                />
                <RankingCard
                  title="Top projects"
                  caption="Projects most frequently touched by submissions"
                  buckets={stats.topProjects}
                />
              </SimpleGrid>

              <Card radius="xl" padding="lg" className="surface-card">
                <Stack gap="md">
                  <Group justify="space-between">
                    <div>
                      <Text fw={700}>Database footprint</Text>
                      <Text size="sm" c="dimmed">
                        Current spread of saved records across people and scope.
                      </Text>
                    </div>
                    <Badge variant="light" color="blue">
                      Live
                    </Badge>
                  </Group>
                  <Divider color="rgba(146, 195, 208, 0.12)" />
                  <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
                    <div className="footprint-item">
                      <Text className="metric-label">Active owners</Text>
                      <Text className="footprint-value">{stats.uniqueOwners}</Text>
                    </div>
                    <div className="footprint-item">
                      <Text className="metric-label">Touched projects</Text>
                      <Text className="footprint-value">{stats.uniqueProjects}</Text>
                    </div>
                    <div className="footprint-item">
                      <Text className="metric-label">Average duration</Text>
                      <Text className="footprint-value">
                        {stats.averageDurationDays} days
                      </Text>
                    </div>
                  </SimpleGrid>
                </Stack>
              </Card>

              <Card radius="xl" padding="lg" className="surface-card">
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Text fw={700}>Import and export</Text>
                      <Text size="sm" c="dimmed">
                        Export the database as JSON or CSV, or replace it from a JSON file.
                      </Text>
                    </div>
                    <Badge variant="light" color="blue">
                      Transfer
                    </Badge>
                  </Group>

                  <Group gap="sm">
                    <Button
                      variant="light"
                      color="blue"
                      radius="xl"
                      onClick={handleExportJson}
                    >
                      Export JSON
                    </Button>
                    <Button
                      variant="light"
                      color="gray"
                      radius="xl"
                      onClick={handleExportCsv}
                    >
                      Export CSV
                    </Button>
                    <Button component="label" variant="default" color="blue" radius="xl">
                      Import JSON
                      <input
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0]
                          if (file) {
                            void handleImportJson(file)
                          }
                          event.currentTarget.value = ''
                        }}
                      />
                    </Button>
                  </Group>

                  {importExportMessage ? (
                    <Text size="sm" c="dimmed">
                      {importExportMessage}
                    </Text>
                  ) : null}

                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                    <div className="footprint-item">
                      <Text className="metric-label">Attachment files</Text>
                      <Text className="footprint-value">
                        {attachmentStorageStats.fileCount}
                      </Text>
                      <Text size="sm" c="dimmed">
                        Stored outside the JSON database.
                      </Text>
                    </div>
                    <div className="footprint-item">
                      <Text className="metric-label">Attachment storage</Text>
                      <Text className="footprint-value">
                        {formatBytes(attachmentStorageStats.totalSizeBytes)}
                      </Text>
                      <Button
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        size="compact-sm"
                        mt="xs"
                        onClick={() => void refreshAttachmentStorageStats()}
                        loading={isRefreshingAttachmentStats}
                      >
                        Refresh storage
                      </Button>
                    </div>
                  </SimpleGrid>

                  <Divider color="rgba(146, 195, 208, 0.12)" />

                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <div>
                        <Text fw={700}>Recent backups</Text>
                        <Text size="sm" c="dimmed">
                          Automatic snapshots created before database replacement and restore.
                        </Text>
                      </div>
                      <Button
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        onClick={() => void refreshBackups()}
                        loading={isRefreshingBackups}
                        disabled={isBootstrapping}
                      >
                        Refresh backups
                      </Button>
                    </Group>

                    {databaseBackups.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        No backups found yet. Importing or restoring the database will create one automatically.
                      </Text>
                    ) : (
                      <Stack gap="xs">
                        {databaseBackups.map((backup) => (
                          <Card key={backup.path} radius="lg" padding="md" className="surface-card">
                            <Group justify="space-between" align="flex-start" gap="md">
                              <div>
                                <Text fw={700}>{backup.fileName}</Text>
                                <Text size="sm" c="dimmed">
                                  Saved {formatTimestamp(backup.modifiedAt)} · {formatBytes(backup.sizeBytes)}
                                </Text>
                                <Text size="sm" c="dimmed">
                                  {backup.path}
                                </Text>
                              </div>
                              <Button
                                variant="light"
                                color="blue"
                                radius="xl"
                                onClick={() => void handleRestoreBackup(backup)}
                                loading={isRestoringBackupPath === backup.path}
                                disabled={
                                  isBootstrapping ||
                                  (isRestoringBackupPath !== null &&
                                    isRestoringBackupPath !== backup.path)
                                }
                              >
                                Restore
                              </Button>
                            </Group>
                          </Card>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Stack>
              </Card>
            </Stack>
          ) : currentPage === 'form' ? (
            <form onSubmit={form.onSubmit(handleSubmit)}>
              <Stack gap="lg">
                <div className="section-header">
                  <div>
                    <Text className="eyebrow">Create / Edit</Text>
                    <Title order={2} className="form-title">
                      {editingRecordId ? 'Edit record' : 'Tracker form'}
                    </Title>
                    <Text className="form-copy">
                      {editingRecordId
                        ? 'Update the selected record and save the revised content back into the shared JSON database.'
                        : 'Create a structured activity record and append it to the shared JSON database.'}
                    </Text>
                  </div>

                  <Group gap="sm">
                    {editingRecordId ? (
                      <Button
                        type="button"
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        onClick={cancelEditingRecord}
                      >
                        Cancel edit
                      </Button>
                    ) : null}
                    {isBootstrapping ? <Loader size="sm" /> : null}
                  </Group>
                </div>

                <div className="form-section-label">
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" className="form-section-eyebrow">Identification</Text>
                  <Divider />
                </div>

                <div className="grid-2">
                  <TextInput
                    label="Title"
                    placeholder="Quarterly reporting automation"
                    size="md"
                    required
                    {...form.getInputProps('title')}
                  />

                  <Select
                    label="Owner"
                    placeholder="Select an owner"
                    data={bootstrapData.owners}
                    size="md"
                    leftSection={<IconUsersGroup size={16} />}
                    required
                    searchable
                    {...form.getInputProps('owner')}
                  />
                </div>

                <div className="form-section-label">
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" className="form-section-eyebrow">Classification</Text>
                  <Divider />
                </div>

                <div className="grid-2">
                  <MultiSelect
                    label="Project"
                    placeholder="Select one or more projects"
                    data={bootstrapData.projects}
                    size="md"
                    searchable
                    hidePickedOptions
                    leftSection={<IconFolders size={16} />}
                    required
                    {...form.getInputProps('projects')}
                  />

                  <MultiSelect
                    label="Departments"
                    placeholder="Choose the involved departments"
                    data={bootstrapData.departments}
                    size="md"
                    searchable
                    hidePickedOptions
                    required
                    {...form.getInputProps('departments')}
                  />
                </div>

                <MultiSelect
                  label="Category"
                  placeholder="Choose one or more categories"
                  data={bootstrapData.categories}
                  searchable
                  hidePickedOptions
                  required
                  {...form.getInputProps('categories')}
                />

                <div className="form-section-label">
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" className="form-section-eyebrow">Schedule</Text>
                  <Divider />
                </div>

                <div className="grid-2">
                  <DateInput
                    label="Start date"
                    placeholder="Pick start date"
                    valueFormat="DD MMM YYYY"
                    clearable
                    required
                    {...form.getInputProps('startDate')}
                  />

                  <DateInput
                    label="End date"
                    placeholder="Pick end date"
                    valueFormat="DD MMM YYYY"
                    clearable
                    required
                    {...form.getInputProps('endDate')}
                  />
                </div>

                <div className="form-section-label">
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" className="form-section-eyebrow">Description</Text>
                  <Divider />
                </div>

                <Textarea
                  label="Description"
                  placeholder="Describe the activity, expected outcome, and any cross-team notes"
                  minRows={4}
                  autosize
                  required
                  {...form.getInputProps('description')}
                />

                <div className="form-section-label">
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" className="form-section-eyebrow">Scoring</Text>
                  <Divider />
                </div>

                <div className="grid-3">
                  <Select
                    label="Effort"
                    placeholder="Select effort"
                    data={effortOptions}
                    required
                    {...form.getInputProps('effort')}
                  />

                  <Select
                    label="Impact"
                    placeholder="Select impact"
                    data={impactOptions}
                    required
                    {...form.getInputProps('impact')}
                  />

                  <Select
                    label="Priority"
                    placeholder="Select priority"
                    data={priorityOptions}
                    required
                    {...form.getInputProps('priority')}
                  />
                </div>

                <div className="form-section-label">
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" className="form-section-eyebrow">Tracking</Text>
                  <Divider />
                </div>

                <div className="grid-2">
                  <Select
                    label="Status"
                    placeholder="Select status"
                    data={trackerStatusOptions}
                    required
                    {...form.getInputProps('status')}
                  />

                  <Select
                    label="Reminder cadence"
                    placeholder="Select reminder cadence"
                    data={reminderOptions}
                    required
                    {...form.getInputProps('reminderCadence')}
                  />
                </div>

                {selectedCategoryImpactFactor !== null ? (
                  <div className="category-impact-panel">
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Text fw={700}>Selected activity type weight</Text>
                        <Text size="sm" c="dimmed">
                          Weighted Insights use the highest factor when multiple
                          categories are selected.
                        </Text>
                      </div>
                      <Badge variant="light" color="green" radius="xl">
                        {formatImpactFactor(selectedCategoryImpactFactor)}x
                      </Badge>
                    </Group>
                    <div className="category-impact-list">
                      {selectedCategoryImpactDetails.map((entry) => (
                        <Badge
                          key={entry.category}
                          variant="light"
                          color="blue"
                          radius="xl"
                        >
                          {entry.category}: {formatImpactFactor(entry.factor)}x
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="form-section-label">
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" className="form-section-eyebrow">Attachments</Text>
                  <Divider />
                </div>

                <div>
                  <InputLabel required mb={8}>
                    Attachments
                  </InputLabel>
                  <div
                    className={`attachment-dropzone ${isDraggingFiles ? 'dragging' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setIsDraggingFiles(true)
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      setIsDraggingFiles(true)
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault()
                      const nextTarget = event.relatedTarget
                      if (
                        !nextTarget ||
                        !(nextTarget instanceof Node) ||
                        !event.currentTarget.contains(nextTarget)
                      ) {
                        setIsDraggingFiles(false)
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      setIsDraggingFiles(false)
                      void addFiles(event.dataTransfer.files)
                    }}
                  >
                    <Stack gap="xs" align="center">
                      <ThemeIcon variant="light" color="blue" size="xl" radius="xl">
                        <IconPaperclip size={18} />
                      </ThemeIcon>
                      <Text fw={700}>Drag and drop one or more files here</Text>
                      <Text size="sm" c="dimmed" ta="center">
                        Attachments are stored as managed files beside the shared JSON database.
                        Limit: 10 files, 10 MB each. In the desktop app you can
                        also drop files anywhere while this page is open.
                      </Text>
                      <Button
                        component="label"
                        variant="light"
                        color="blue"
                        radius="xl"
                      >
                        Choose files
                        <input
                          type="file"
                          multiple
                          hidden
                          onChange={(event) => {
                            const fileList = event.currentTarget.files
                            if (fileList) {
                              void addFiles(fileList)
                            }
                            event.currentTarget.value = ''
                          }}
                        />
                      </Button>
                    </Stack>
                  </div>
                  {attachmentError ? (
                    <Text className="attachment-error">{attachmentError}</Text>
                  ) : null}
                  {form.errors.attachments ? (
                    <Text className="attachment-error">{form.errors.attachments}</Text>
                  ) : null}
                  {form.values.attachments.length > 0 ? (
                    <div className="attachment-list">
                      {form.values.attachments.map((attachment, index) => (
                        <div className="attachment-item" key={`${attachment.fileName}-${index}`}>
                          <div className="attachment-main">
                            <ThemeIcon
                              variant="light"
                              color="blue"
                              radius="xl"
                              className="attachment-icon"
                            >
                              {attachmentIcon(attachment)}
                            </ThemeIcon>
                            <div>
                              <Text fw={600}>{attachment.fileName}</Text>
                              <Text size="sm" c="dimmed">
                                {attachment.mimeType} · {formatBytes(attachment.sizeBytes)}
                              </Text>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="subtle"
                            color="red"
                            radius="xl"
                            onClick={() => removeAttachment(index)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="submit-row">
                  <Text className="submit-note">
                    {editingRecordId
                      ? 'The record keeps its original id and timestamp while its saved content is updated in place.'
                      : 'The backend generates the record id and submission timestamp, then refreshes the overview page after save.'}
                  </Text>
                  <Button
                    type="submit"
                    size="md"
                    radius="xl"
                    loading={isSaving}
                    disabled={isBootstrapping}
                  >
                    {editingRecordId ? 'Update Activity' : 'Save Activity'}
                  </Button>
                </div>
              </Stack>
            </form>
          ) : currentPage === 'records' ? (
            <Stack gap="lg">
              <div className="section-header">
                <div>
                  <Text className="eyebrow">Issues</Text>
                  <Title order={2} className="form-title">
                    Saved records
                  </Title>
                  <Text className="form-copy">
                    Select an item to inspect it in detail. Use <code>J</code> and{' '}
                    <code>K</code> to move through the list, and <code>E</code> to
                    jump into edit mode.
                  </Text>
                </div>

                <Button
                  variant="light"
                  color="blue"
                  radius="xl"
                  onClick={() => void refreshRecords()}
                  loading={isRefreshingRecords}
                  disabled={isBootstrapping}
                >
                  Refresh records
                </Button>
              </div>

              <div className="records-layout">
                <Card radius="xl" padding="lg" className="surface-card">
                  <Stack gap="md">
                    <Group justify="space-between">
                      <div>
                        <Text fw={700}>Record list</Text>
                        <Text size="sm" c="dimmed">
                          {filteredRecords.length} saved record
                          {filteredRecords.length === 1 ? '' : 's'}
                        </Text>
                      </div>
                      <Badge variant="light" color="blue">
                        Latest first
                      </Badge>
                    </Group>

                    {filteredRecords.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        No records match the current filters.
                      </Text>
                    ) : (
                      <div className="records-list">
                        {filteredRecords.map((record) => (
                          <div
                            key={record.id}
                            className={`record-item ${
                              selectedRecordId === record.id ? 'active' : ''
                            }`}
                          >
                            <button
                              type="button"
                              className="record-item-details"
                              onClick={() => setSelectedRecordId(record.id)}
                            >
                              <div className="record-row-main">
                                <div className="record-row-head">
                                  <Text className="record-row-key">
                                    {formatRecordKey(record.id)}
                                  </Text>
                                  <Group gap="xs">
                                    {signalBadges(
                                      record,
                                      bootstrapData.reminderCadences,
                                    ).map((badge) => (
                                      <Badge
                                        key={`${record.id}-${badge.label}`}
                                        variant="light"
                                        color={badge.color}
                                        radius="xl"
                                      >
                                        {badge.label}
                                      </Badge>
                                    ))}
                                    <Badge
                                      variant="light"
                                      color={activityStatusColor(record.status)}
                                      radius="xl"
                                    >
                                      {record.status}
                                    </Badge>
                                    <Badge variant="light" color="blue" radius="xl">
                                      {record.priority}
                                    </Badge>
                                  </Group>
                                </div>
                                <Text fw={700}>{record.title}</Text>
                                <div className="record-row-meta">
                                  <span>{record.owner}</span>
                                  <span>{formatDateRange(record.startDate, record.endDate)}</span>
                                  <span>{record.reminderCadence} reminder</span>
                                  <span>
                                    {record.comments.length} comment
                                    {record.comments.length === 1 ? '' : 's'}
                                  </span>
                                  <span>
                                    {record.attachments.length} file
                                    {record.attachments.length === 1 ? '' : 's'}
                                  </span>
                                </div>
                              </div>
                            </button>
                            <Button
                              type="button"
                              variant="default"
                              color="blue"
                              radius="xl"
                              size="compact-sm"
                              className="record-edit-button"
                              onClick={() => startEditingRecord(record)}
                            >
                              Edit
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Stack>
                </Card>

                <Card radius="xl" padding="lg" className="surface-card">
                  {selectedRecord ? (
                    <Stack gap="lg">
                      <div>
                        <Group justify="space-between" align="flex-start">
                          <div>
                            <Text className="eyebrow">Recalled Record</Text>
                            <Title order={3} className="record-title">
                              {selectedRecord.title}
                            </Title>
                            <Text size="sm" c="dimmed" mt={6}>
                              {formatRecordKey(selectedRecord.id)} · Saved{' '}
                              {formatTimestamp(selectedRecord.submittedAt)}
                            </Text>
                          </div>
                          <Group gap="xs">
                            <Badge
                              variant="light"
                              color={activityStatusColor(selectedRecord.status)}
                            >
                              {selectedRecord.status}
                            </Badge>
                            <Badge variant="light" color="blue">
                              {selectedRecord.priority} priority
                            </Badge>
                          </Group>
                        </Group>
                      </div>

                      <Group gap="sm" justify="space-between" className="detail-toolbar">
                        <div className="record-chip-row">
                          <span className="record-chip">{selectedRecord.owner}</span>
                          <span className="record-chip">{selectedRecord.status}</span>
                          <span className="record-chip">
                            {selectedRecord.reminderCadence} reminder
                          </span>
                          <span className="record-chip">
                            {selectedRecord.effort} effort
                          </span>
                          <span className="record-chip">
                            {selectedRecord.impact} impact
                          </span>
                          <span className="record-chip">
                            {selectedRecord.projects.length} project
                            {selectedRecord.projects.length === 1 ? '' : 's'}
                          </span>
                          {signalBadges(
                            selectedRecord,
                            bootstrapData.reminderCadences,
                          ).map((badge) => (
                            <span className="record-chip record-chip-signal" key={badge.label}>
                              {badge.label}
                            </span>
                          ))}
                        </div>
                        <Button
                          type="button"
                          variant="default"
                          color="blue"
                          radius="xl"
                          onClick={() => startEditingRecord(selectedRecord)}
                        >
                          Edit record
                        </Button>
                      </Group>

                      <Card radius="xl" padding="lg" className="record-description-card">
                        <Stack gap="md">
                          <Group justify="space-between" align="flex-start">
                            <div>
                              <Text fw={700}>Quick updates</Text>
                              <Text size="sm" c="dimmed">
                                Reassign the owner, move status, or change reminder cadence without opening full edit mode.
                              </Text>
                            </div>
                            <Badge variant="light" color="blue">
                              Fast path
                            </Badge>
                          </Group>

                          <div className="grid-3">
                            <Select
                              label="Owner"
                              data={bootstrapData.owners}
                              value={quickOwner}
                              onChange={setQuickOwner}
                              searchable
                            />
                            <Select
                              label="Status"
                              data={trackerStatusOptions}
                              value={quickStatus}
                              onChange={(value) => setQuickStatus(value as ActivityStatus | null)}
                            />
                            <Select
                              label="Reminder cadence"
                              data={reminderOptions}
                              value={quickReminderCadence}
                              onChange={(value) =>
                                setQuickReminderCadence(value as ReminderCadence | null)
                              }
                            />
                          </div>

                          <div className="comment-actions">
                            <Text className="submit-note">
                              Last activity {formatTimestamp(selectedRecord.lastModifiedAt || selectedRecord.submittedAt)}
                              {' · '}
                              Reminder due {recordSignalState(
                                selectedRecord,
                                bootstrapData.reminderCadences,
                              ).reminderDate
                                ? formatShortDate(
                                    recordSignalState(
                                      selectedRecord,
                                      bootstrapData.reminderCadences,
                                    ).reminderDate?.toISOString() ?? null,
                                  )
                                : 'Not scheduled'}
                            </Text>
                            <Button
                              type="button"
                              radius="xl"
                              color="blue"
                              onClick={() => void handleApplyQuickRecordChanges()}
                              loading={isQuickSaving}
                            >
                              Save quick updates
                            </Button>
                          </div>
                        </Stack>
                      </Card>

                      <div className="record-meta-grid record-meta-grid-compact">
                        <div className="footprint-item">
                          <Text className="metric-label">Owner and range</Text>
                          <Text className="record-value">{selectedRecord.owner}</Text>
                          <Text className="record-value">
                            {formatDateRange(
                              selectedRecord.startDate,
                              selectedRecord.endDate,
                            )}
                          </Text>
                        </div>
                        <div className="footprint-item">
                          <Text className="metric-label">Scope</Text>
                          <Text className="record-value">
                            {selectedRecord.projects.join(', ')}
                          </Text>
                          <Text size="sm" c="dimmed">
                            {selectedRecord.departments.join(', ')}
                          </Text>
                        </div>
                        <div className="footprint-item">
                          <Text className="metric-label">Signals</Text>
                          <Text className="record-value">
                            {selectedRecord.attachments.length} attachment
                            {selectedRecord.attachments.length === 1 ? '' : 's'} ·{' '}
                            {selectedRecord.comments.length} comment
                            {selectedRecord.comments.length === 1 ? '' : 's'}
                          </Text>
                          <Text size="sm" c="dimmed">
                            {selectedRecord.categories.join(', ')}
                          </Text>
                        </div>
                      </div>

                      <Card radius="xl" padding="lg" className="record-description-card">
                        <Stack gap="sm">
                          <Text fw={700}>Description</Text>
                          <Text className="record-description">
                            {selectedRecord.description}
                          </Text>
                        </Stack>
                      </Card>

                      {selectedRecord.attachments.length > 0 ? (
                        <Card radius="xl" padding="lg" className="record-description-card">
                          <Stack gap="sm">
                            <Group justify="space-between" align="flex-start">
                              <div>
                                <Text fw={700}>Saved attachments</Text>
                                <Text size="sm" c="dimmed">
                                  Preview supported images, PDFs, and text-like files inline.
                                </Text>
                              </div>
                            </Group>
                            <div className="attachment-list">
                              {selectedRecord.attachments.map((attachment, index) => {
                                const attachmentKey = buildAttachmentKey(selectedRecord.id, attachment)
                                const loadedPreviewData = previewAttachmentDataByKey[attachmentKey]

                                return (
                                <div key={`${attachment.id}-${attachment.fileName}-${index}`}>
                                  <div className="attachment-download">
                                    <div className="attachment-main">
                                      <ThemeIcon
                                        variant="light"
                                        color="blue"
                                        radius="xl"
                                        className="attachment-icon"
                                      >
                                        {attachmentIcon(attachment)}
                                      </ThemeIcon>
                                      <div>
                                        <Text fw={600}>{attachment.fileName}</Text>
                                        <Text size="sm" c="dimmed">
                                          {attachment.mimeType} · {formatBytes(attachment.sizeBytes)}
                                        </Text>
                                      </div>
                                    </div>
                                    <Group gap="xs">
                                      {previewAttachmentKind(attachment) ? (
                                        <Button
                                          type="button"
                                          variant="subtle"
                                          color="gray"
                                          radius="xl"
                                          size="compact-sm"
                                          onClick={() =>
                                            void toggleAttachmentPreview(selectedRecord.id, attachment)
                                          }
                                          loading={loadingAttachmentKey === attachmentKey}
                                        >
                                          {previewAttachmentKey === attachmentKey
                                            ? 'Hide preview'
                                            : 'Preview'}
                                        </Button>
                                      ) : null}
                                      <Button
                                        type="button"
                                        variant="subtle"
                                        color="blue"
                                        radius="xl"
                                        size="compact-sm"
                                        onClick={() =>
                                          void handleDownloadAttachment(selectedRecord.id, attachment)
                                        }
                                        loading={loadingAttachmentKey === attachmentKey}
                                      >
                                        Download
                                      </Button>
                                    </Group>
                                  </div>

                                  {previewAttachmentKey === attachmentKey ? (
                                    <div className="attachment-preview">
                                      {previewAttachmentKind(attachment) === 'image' ? (
                                        <img
                                          src={
                                            attachmentPreviewData(attachment, loadedPreviewData) ??
                                            undefined
                                          }
                                          alt={attachment.fileName}
                                          className="attachment-preview-image"
                                        />
                                      ) : previewAttachmentKind(attachment) === 'pdf' ? (
                                        <iframe
                                          src={
                                            attachmentPreviewData(attachment, loadedPreviewData) ??
                                            undefined
                                          }
                                          title={attachment.fileName}
                                          className="attachment-preview-frame"
                                        />
                                      ) : (
                                        <pre className="attachment-preview-text">
                                          {attachmentPreviewData(attachment, loadedPreviewData)}
                                        </pre>
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                                )
                              })}
                            </div>
                          </Stack>
                        </Card>
                      ) : null}

                      <Card radius="xl" padding="lg" className="record-description-card">
                        <Stack gap="md">
                          <Group justify="space-between" align="flex-start">
                            <div>
                              <Text fw={700}>Comments</Text>
                              <Text size="sm" c="dimmed">
                                Add notes after creation, or edit and remove previous
                                comments as needed.
                              </Text>
                            </div>
                            <Group gap="xs">
                              <Badge variant="light" color="blue">
                                {selectedRecord.comments.length} comment
                                {selectedRecord.comments.length === 1 ? '' : 's'}
                              </Badge>
                              <Button
                                type="button"
                                variant="subtle"
                                color="gray"
                                radius="xl"
                                size="compact-sm"
                                rightSection={
                                  areCommentsCollapsed ? (
                                    <IconChevronDown size={14} />
                                  ) : (
                                    <IconChevronUp size={14} />
                                  )
                                }
                                onClick={() =>
                                  setAreCommentsCollapsed((current) => !current)
                                }
                              >
                                {areCommentsCollapsed ? 'Show' : 'Hide'}
                              </Button>
                            </Group>
                          </Group>

                          {areCommentsCollapsed ? (
                            <Text size="sm" c="dimmed">
                              Comments are collapsed by default. Expand to add a new
                              comment or review the thread.
                            </Text>
                          ) : (
                            <>
                          <Textarea
                            label="New comment"
                            placeholder="Add progress notes, follow-ups, decisions, or handoff context. Use @mentions when helpful."
                            minRows={4}
                            autosize
                            value={commentMessage}
                            onChange={(event) => {
                              setCommentMessage(event.currentTarget.value)
                              if (commentError) {
                                setCommentError(null)
                              }
                            }}
                          />

                          <div className="attachment-dropzone compact">
                            <Group justify="space-between" align="center">
                              <div>
                                <Text fw={700}>Comment attachments</Text>
                                <Text size="sm" c="dimmed">
                                  Attach files to this update without embedding bytes in the main JSON database.
                                </Text>
                              </div>
                              <Button
                                variant="light"
                                color="blue"
                                radius="xl"
                                component="label"
                              >
                                Add files
                                <input
                                  type="file"
                                  multiple
                                  hidden
                                  onChange={(event) => {
                                    if (event.currentTarget.files) {
                                      void addCommentFiles(event.currentTarget.files)
                                    }
                                    event.currentTarget.value = ''
                                  }}
                                />
                              </Button>
                            </Group>

                            {commentAttachments.length > 0 ? (
                              <div className="attachment-list">
                                {commentAttachments.map((attachment, index) => (
                                  <div
                                    className="attachment-download"
                                    key={`${attachment.id}-${attachment.fileName}-${index}`}
                                  >
                                    <div className="attachment-main">
                                      <ThemeIcon
                                        variant="light"
                                        color="blue"
                                        radius="xl"
                                        className="attachment-icon"
                                      >
                                        {attachmentIcon(attachment)}
                                      </ThemeIcon>
                                      <div>
                                        <Text fw={600}>{attachment.fileName}</Text>
                                        <Text size="sm" c="dimmed">
                                          {attachment.mimeType} · {formatBytes(attachment.sizeBytes)}
                                        </Text>
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="subtle"
                                      color="red"
                                      radius="xl"
                                      size="compact-sm"
                                      onClick={() => removeCommentAttachment(index)}
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>

                          {commentError ? (
                            <Text className="attachment-error">{commentError}</Text>
                          ) : null}

                          <div className="comment-actions">
                            <Text className="submit-note">
                              Comments stay attached to the record timeline and can be
                              edited or deleted later.
                            </Text>
                            <Button
                              type="button"
                              radius="xl"
                              color="blue"
                              onClick={() => void handleAppendComment()}
                              loading={isSavingComment}
                              disabled={isBootstrapping}
                            >
                              Add comment
                            </Button>
                          </div>

                          {selectedRecordComments.length === 0 ? (
                            <Text size="sm" c="dimmed">
                              No comments yet. Add the first update for this item here.
                            </Text>
                          ) : (
                            <div className="comment-thread">
                              {selectedRecordComments.map((comment) => (
                                <div className="comment-item" key={comment.id}>
                                  <div className="comment-header">
                                    <Text size="sm" c="dimmed">
                                      {formatTimestamp(comment.createdAt)}
                                    </Text>
                                    <Group gap="xs">
                                      {editingCommentId === comment.id ? (
                                        <>
                                          <Button
                                            type="button"
                                            variant="default"
                                            color="green"
                                            radius="xl"
                                            size="compact-sm"
                                            leftSection={<IconCheck size={14} />}
                                            onClick={() => void handleSaveEditedComment(comment.id)}
                                            loading={isSavingComment}
                                          >
                                            Save
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="subtle"
                                            color="gray"
                                            radius="xl"
                                            size="compact-sm"
                                            leftSection={<IconX size={14} />}
                                            onClick={cancelEditingComment}
                                          >
                                            Cancel
                                          </Button>
                                        </>
                                      ) : (
                                        <>
                                          <Button
                                            type="button"
                                            variant="subtle"
                                            color="blue"
                                            radius="xl"
                                            size="compact-sm"
                                            leftSection={<IconEdit size={14} />}
                                            onClick={() => startEditingComment(comment)}
                                          >
                                            Edit
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="subtle"
                                            color="red"
                                            radius="xl"
                                            size="compact-sm"
                                            leftSection={<IconTrash size={14} />}
                                            onClick={() => void handleDeleteComment(comment.id)}
                                            loading={isDeletingCommentId === comment.id}
                                          >
                                            Delete
                                          </Button>
                                        </>
                                      )}
                                    </Group>
                                  </div>
                                  {editingCommentId === comment.id ? (
                                    <Textarea
                                      value={editingCommentMessage}
                                      minRows={4}
                                      autosize
                                      onChange={(event) => {
                                        setEditingCommentMessage(event.currentTarget.value)
                                        if (commentError) {
                                          setCommentError(null)
                                        }
                                      }}
                                    />
                                  ) : (
                                    <div className="comment-body">
                                      <Text className="record-description">
                                        {renderCommentWithMentions(comment.message)}
                                      </Text>
                                      {extractMentions(comment.message).length > 0 ? (
                                        <div className="mention-list">
                                          {extractMentions(comment.message).map((mention) => (
                                            <Badge
                                              variant="light"
                                              color="grape"
                                              radius="xl"
                                              key={mention}
                                            >
                                              {mention}
                                            </Badge>
                                          ))}
                                        </div>
                                      ) : null}
                                      {comment.attachments.length > 0 ? (
                                        <div className="attachment-list comment-attachment-list">
                                          {comment.attachments.map((attachment, index) => {
                                            const attachmentKey = buildAttachmentKey(
                                              selectedRecord.id,
                                              attachment,
                                              comment.id,
                                            )
                                            const loadedPreviewData =
                                              previewAttachmentDataByKey[attachmentKey]

                                            return (
                                              <div
                                                key={`${attachment.id}-${attachment.fileName}-${index}`}
                                              >
                                                <div className="attachment-download">
                                                  <div className="attachment-main">
                                                    <ThemeIcon
                                                      variant="light"
                                                      color="blue"
                                                      radius="xl"
                                                      className="attachment-icon"
                                                    >
                                                      {attachmentIcon(attachment)}
                                                    </ThemeIcon>
                                                    <div>
                                                      <Text fw={600}>{attachment.fileName}</Text>
                                                      <Text size="sm" c="dimmed">
                                                        {attachment.mimeType} ·{' '}
                                                        {formatBytes(attachment.sizeBytes)}
                                                      </Text>
                                                    </div>
                                                  </div>
                                                  <Group gap="xs">
                                                    {previewAttachmentKind(attachment) ? (
                                                      <Button
                                                        type="button"
                                                        variant="subtle"
                                                        color="gray"
                                                        radius="xl"
                                                        size="compact-sm"
                                                        onClick={() =>
                                                          void toggleAttachmentPreview(
                                                            selectedRecord.id,
                                                            attachment,
                                                            comment.id,
                                                          )
                                                        }
                                                        loading={
                                                          loadingAttachmentKey === attachmentKey
                                                        }
                                                      >
                                                        {previewAttachmentKey === attachmentKey
                                                          ? 'Hide preview'
                                                          : 'Preview'}
                                                      </Button>
                                                    ) : null}
                                                    <Button
                                                      type="button"
                                                      variant="subtle"
                                                      color="blue"
                                                      radius="xl"
                                                      size="compact-sm"
                                                      onClick={() =>
                                                        void handleDownloadAttachment(
                                                          selectedRecord.id,
                                                          attachment,
                                                          comment.id,
                                                        )
                                                      }
                                                      loading={loadingAttachmentKey === attachmentKey}
                                                    >
                                                      Download
                                                    </Button>
                                                  </Group>
                                                </div>
                                                {previewAttachmentKey === attachmentKey ? (
                                                  <div className="attachment-preview">
                                                    {previewAttachmentKind(attachment) === 'image' ? (
                                                      <img
                                                        src={
                                                          attachmentPreviewData(
                                                            attachment,
                                                            loadedPreviewData,
                                                          ) ?? undefined
                                                        }
                                                        alt={attachment.fileName}
                                                        className="attachment-preview-image"
                                                      />
                                                    ) : previewAttachmentKind(attachment) === 'pdf' ? (
                                                      <iframe
                                                        src={
                                                          attachmentPreviewData(
                                                            attachment,
                                                            loadedPreviewData,
                                                          ) ?? undefined
                                                        }
                                                        title={attachment.fileName}
                                                        className="attachment-preview-frame"
                                                      />
                                                    ) : (
                                                      <pre className="attachment-preview-text">
                                                        {attachmentPreviewData(
                                                          attachment,
                                                          loadedPreviewData,
                                                        )}
                                                      </pre>
                                                    )}
                                                  </div>
                                                ) : null}
                                              </div>
                                            )
                                          })}
                                        </div>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                            </>
                          )}
                        </Stack>
                      </Card>

                      <Card radius="xl" padding="lg" className="record-description-card">
                        <Stack gap="md">
                          <Group justify="space-between" align="flex-start">
                            <div>
                              <Text fw={700}>Activity history</Text>
                              <Text size="sm" c="dimmed">
                                Tracks record edits, quick updates, and comment operations over time.
                              </Text>
                            </div>
                            <Group gap="xs">
                              <Badge variant="light" color="blue">
                                {selectedRecordHistory.length} event
                                {selectedRecordHistory.length === 1 ? '' : 's'}
                              </Badge>
                              <Button
                                type="button"
                                variant="subtle"
                                color="gray"
                                radius="xl"
                                size="compact-sm"
                                rightSection={
                                  isHistoryCollapsed ? (
                                    <IconChevronDown size={14} />
                                  ) : (
                                    <IconChevronUp size={14} />
                                  )
                                }
                                onClick={() =>
                                  setIsHistoryCollapsed((current) => !current)
                                }
                              >
                                {isHistoryCollapsed ? 'Show' : 'Hide'}
                              </Button>
                            </Group>
                          </Group>

                          {isHistoryCollapsed ? (
                            <Text size="sm" c="dimmed">
                              Activity history is collapsed by default. Expand to review
                              record changes and comment operations.
                            </Text>
                          ) : selectedRecordHistory.length === 0 ? (
                            <Text size="sm" c="dimmed">
                              No audit history is available for this record yet.
                            </Text>
                          ) : (
                            <div className="history-thread">
                              {selectedRecordHistory.map((entry: RecordHistoryEntry) => (
                                <div className="history-item" key={entry.id}>
                                  <Text size="sm" c="dimmed">
                                    {formatTimestamp(entry.createdAt)}
                                  </Text>
                                  <Text fw={600}>{entry.message}</Text>
                                  <Text size="sm" c="dimmed">
                                    {entry.kind}
                                  </Text>
                                </div>
                              ))}
                            </div>
                          )}
                        </Stack>
                      </Card>
                    </Stack>
                  ) : (
                    <Stack justify="center" h="100%">
                      <Text fw={700}>No record selected</Text>
                      <Text size="sm" c="dimmed">
                        Choose a title from the list to recall its stored content.
                      </Text>
                    </Stack>
                  )}
                </Card>
              </div>
            </Stack>
          ) : currentPage === 'board' ? (
            <Stack gap="lg">
              <div className="section-header">
                <div>
                  <Text className="eyebrow">Board</Text>
                  <Title order={2} className="form-title">
                    Status board
                  </Title>
                  <Text className="form-copy">
                    Scan the filtered tracker as a Kanban board grouped by workflow
                    status. Drag cards between columns to update status, or select
                    any card to jump into its full record detail.
                  </Text>
                </div>

                <Group gap="sm">
                  <Button
                    variant="light"
                    color="blue"
                    radius="xl"
                    onClick={() => void refreshRecords()}
                    loading={isRefreshingRecords}
                    disabled={isBootstrapping}
                  >
                    Refresh board
                  </Button>
                  {completedStatusLabel ? (
                    <Button
                      variant={showCompletedColumn ? 'default' : 'light'}
                      color={showCompletedColumn ? 'gray' : 'blue'}
                      radius="xl"
                      onClick={() => setShowCompletedColumn((current) => !current)}
                    >
                      {showCompletedColumn
                        ? `Hide ${completedStatusLabel}`
                        : `Show ${completedStatusLabel}`}
                    </Button>
                  ) : null}
                </Group>
              </div>

              <div className="board-layout">
                {boardColumns.map((column) => (
                  <Card
                    key={column.status}
                    radius="xl"
                    padding="lg"
                    className="surface-card board-column"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (!draggingRecordId) {
                        return
                      }

                      const record = records.find((entry) => entry.id === draggingRecordId)
                      if (!record || record.status === column.status) {
                        setDraggingRecordId(null)
                        return
                      }

                      void handleQuickUpdateRecord(
                        record,
                        { status: column.status },
                        `Moved "${record.title}" to ${column.status}.`,
                      )
                      setDraggingRecordId(null)
                    }}
                  >
                    <Stack gap="md">
                      <Group justify="space-between" align="center">
                        <Group gap="xs" align="center">
                          <Text fw={700}>{column.status}</Text>
                          <Badge
                            variant="filled"
                            color={activityStatusColor(column.status)}
                            radius="xl"
                            size="sm"
                          >
                            {column.records.length}
                          </Badge>
                        </Group>
                      </Group>

                      {column.records.length === 0 ? (
                        <div className="board-empty">
                          <Text size="sm" c="dimmed">
                            Drop cards here to move them to {column.status}.
                          </Text>
                        </div>
                      ) : (
                        <div className="board-card-list">
                          {column.records.map((record) => (
                            <button
                              type="button"
                              key={record.id}
                              className={`board-card board-card-priority-${record.priority.toLowerCase()}`}
                              draggable
                              onDragStart={() => setDraggingRecordId(record.id)}
                              onDragEnd={() => setDraggingRecordId(null)}
                              onClick={() => {
                                setSelectedRecordId(record.id)
                                setCurrentPage('records')
                              }}
                            >
                              <div className="board-card-head">
                                <Text className="record-row-key">
                                  {formatRecordKey(record.id)}
                                </Text>
                                <Text size="xs" c="dimmed">{record.priority}</Text>
                              </div>
                              <Text fw={700} size="sm">{record.title}</Text>
                              <Text size="xs" c="dimmed">
                                {record.owner}{record.projects.length > 0 ? ` · ${record.projects.slice(0, 1).join(', ')}` : ''}
                              </Text>
                              <div className="board-card-badges">
                                {signalBadges(
                                  record,
                                  bootstrapData.reminderCadences,
                                ).map((badge) => (
                                  <Badge
                                    variant="light"
                                    color={badge.color}
                                    radius="xl"
                                    size="xs"
                                    key={`${record.id}-${badge.label}`}
                                  >
                                    {badge.label}
                                  </Badge>
                                ))}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </Stack>
                  </Card>
                ))}
              </div>
            </Stack>
          ) : currentPage === 'insights' ? (
            <Stack gap="lg">
              <div className="section-header">
                <div>
                  <Text className="eyebrow">Reports</Text>
                  <Title order={2} className="form-title">
                    Database insights
                  </Title>
                  <Text className="form-copy">
                    Slice the database by multiple dimensions and generate
                    visual summaries that reveal cadence, ownership, scope, and
                    delivery patterns.
                  </Text>
                </div>

                <Group gap="sm">
                  <Button
                    variant="light"
                    color="blue"
                    radius="xl"
                    onClick={() => void refreshRecords()}
                    loading={isRefreshingRecords}
                    disabled={isBootstrapping}
                  >
                    Refresh source data
                  </Button>
                </Group>
              </div>

              {isRefreshingRecords ? (
                <>
                  <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="md">
                    {[0, 1, 2, 3].map((i) => (
                      <Card key={i} radius="xl" padding="lg" className="surface-card">
                        <Skeleton height={12} width="60%" mb={12} radius="sm" />
                        <Skeleton height={28} width="40%" mb={8} radius="sm" />
                        <Skeleton height={10} radius="sm" />
                      </Card>
                    ))}
                  </SimpleGrid>
                  <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <Card key={i} radius="xl" padding="lg" className="surface-card">
                        <Skeleton height={14} width="50%" mb={6} radius="sm" />
                        <Skeleton height={10} width="70%" mb={16} radius="sm" />
                        <Skeleton height={140} radius="sm" />
                      </Card>
                    ))}
                  </SimpleGrid>
                </>
              ) : (
                <>
                  <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="md">
                    <InsightMetricCard
                      label="Filtered records"
                      value={String(filteredInsightRecords.length)}
                      caption="All charts below are based on this record set."
                    />
                    <InsightMetricCard
                      label="Average duration"
                      value={`${formatMetricNumber(insightAverageDuration)} days`}
                      caption="Average activity span across the filtered selection."
                    />
                    <InsightMetricCard
                      label={`${featuredPriorityLabel} priority share`}
                      value={`${formatMetricNumber(insightHighPriorityShare)}%`}
                      caption={`How much of the current slice is marked ${featuredPriorityLabel.toLowerCase()} priority.`}
                    />
                    <InsightMetricCard
                      label="Avg attachments"
                      value={formatMetricNumber(insightAverageAttachments)}
                      caption="Average number of embedded files per activity."
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                    <TimelinePlot
                      title="Submission cadence"
                      subtitle="How many activities were submitted each month"
                      data={insightTimeline}
                    />
                    <TimelinePlot
                      title="Average open activities"
                      subtitle="Activities whose active date range overlaps each month"
                      data={insightOpenActivitiesByMonth}
                    />
                    <TimelinePlot
                      title="Weighted open activities"
                      subtitle="Open activity load multiplied by Admin activity-type factors"
                      data={insightWeightedOpenActivitiesByMonth}
                    />
                    <HeatmapPlot
                      title="Effort vs impact"
                      subtitle="Where the current workload sits in the effort-impact matrix"
                      cells={insightHeatmap}
                      efforts={bootstrapData.efforts}
                      impacts={bootstrapData.impacts}
                      valueMode={heatmapValueMode}
                      onValueModeChange={setHeatmapValueMode}
                    />
                    <RankedPlot
                      title="Top owners"
                      subtitle="Who appears most often in the filtered record set"
                      data={insightOwnerBuckets}
                    />
                    <RankedPlot
                      title="Department coverage"
                      subtitle="How often departments are involved across saved work"
                      data={insightDepartmentBuckets}
                    />
                    <RankedPlot
                      title="Project coverage"
                      subtitle="Projects receiving the most tracked activity"
                      data={insightProjectBuckets}
                    />
                    <RankedPlot
                      title="Average duration by owner"
                      subtitle="Which owners tend to have longer-running activities"
                      data={insightDurationByOwner}
                    />
                  </SimpleGrid>

                  <RankedPlot
                    title="Category coverage"
                    subtitle="Categories most represented in the current filtered slice"
                    data={insightCategoryBuckets}
                  />
                </>
              )}
            </Stack>
          ) : currentPage === 'weekly' ? (
            <Stack gap="lg">
              <div className="section-header">
                <div>
                  <Text className="eyebrow">Weekly Digest</Text>
                  <Title order={2} className="form-title">
                    Weekly report
                  </Title>
                  <Text className="form-copy">
                    Generate a plain-text weekly email body from comments created in
                    a selected ISO week or custom date range. Only activities updated
                    inside that window are included.
                  </Text>
                </div>

                <Group gap="sm">
                  <Button
                    variant="light"
                    color="blue"
                    radius="xl"
                    onClick={() => void refreshRecords()}
                    loading={isRefreshingRecords}
                    disabled={isBootstrapping}
                  >
                    Refresh source data
                  </Button>
                  <Button
                    variant="default"
                    color={weeklyCopyState === 'error' ? 'red' : 'blue'}
                    radius="xl"
                    onClick={() => void handleCopyWeeklyReport()}
                  >
                    {weeklyCopyState === 'success'
                      ? 'Copied'
                      : weeklyCopyState === 'error'
                        ? 'Copy failed'
                        : 'Copy to clipboard'}
                  </Button>
                </Group>
              </div>

              <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="md">
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Report window</Text>
                  <Text className="insight-value">
                    {weeklyReportMode === 'week' ? 'ISO week' : 'Date range'}
                  </Text>
                </Card>
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Selected window</Text>
                  <Text className="insight-value">{weeklyWindowLabel}</Text>
                </Card>
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Activities included</Text>
                  <Text className="insight-value">{weeklyReportEntries.length}</Text>
                </Card>
                <Card radius="xl" padding="lg" className="surface-card">
                  <Text className="metric-label">Comments included</Text>
                  <Text className="insight-value">{weeklyIncludedCommentCount}</Text>
                </Card>
              </SimpleGrid>

              <Card radius="xl" padding="lg" className="surface-card">
                <Stack gap="md">
                  <Select
                    label="Selection mode"
                    data={[
                      { value: 'week', label: 'ISO week' },
                      { value: 'range', label: 'Custom date range' },
                    ]}
                    value={weeklyReportMode}
                    onChange={(value) =>
                      setWeeklyReportMode((value as WeeklyReportMode | null) ?? 'week')
                    }
                  />
                  <Select
                    label="Report template"
                    data={[
                      { value: 'bullets', label: 'Bullet list' },
                      { value: 'executive', label: 'Executive summary' },
                      { value: 'owner', label: 'Group by owner' },
                      { value: 'project', label: 'Group by project' },
                    ]}
                    value={weeklyTemplate}
                    onChange={(value) =>
                      setWeeklyTemplate((value as WeeklyTemplate | null) ?? 'bullets')
                    }
                  />

                  {weeklyReportMode === 'week' ? (
                    <>
                      <Group grow align="flex-end">
                        <Select
                          label="Year"
                          data={weeklyYearOptions}
                          value={weeklyReportYear}
                          onChange={(value) =>
                            setWeeklyReportYear(value ?? String(currentIsoYear))
                          }
                        />
                        <Select
                          label="Calendar week"
                          data={weeklyWeekOptions}
                          value={weeklyReportWeek}
                          onChange={(value) => setWeeklyReportWeek(value ?? '1')}
                        />
                      </Group>
                      <Text size="sm" c="dimmed">
                        Weeks use ISO calendar weeks, from Monday through Sunday.
                      </Text>
                    </>
                  ) : (
                    <>
                      <Group grow align="flex-end">
                        <DateInput
                          label="Start date"
                          valueFormat="DD MMM YYYY"
                          value={weeklyRangeStart}
                          onChange={(value) =>
                            setWeeklyRangeStart(value ? dayjs(value).toDate() : null)
                          }
                        />
                        <DateInput
                          label="End date"
                          valueFormat="DD MMM YYYY"
                          value={weeklyRangeEnd}
                          onChange={(value) =>
                            setWeeklyRangeEnd(value ? dayjs(value).toDate() : null)
                          }
                        />
                      </Group>
                      <Text size="sm" c="dimmed">
                        The report includes comments created between the two selected
                        dates, inclusive.
                      </Text>
                    </>
                  )}
                </Stack>
              </Card>

              <Card radius="xl" padding="lg" className="surface-card">
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Text fw={700}>Email preview</Text>
                      <Text size="sm" c="dimmed">
                        Plain text, ready to paste into an email body.
                      </Text>
                    </div>
                    <Badge variant="light" color="blue">
                      {weeklyReportEntries.length} item
                      {weeklyReportEntries.length === 1 ? '' : 's'}
                    </Badge>
                  </Group>

                  <Textarea
                    value={weeklyReportText}
                    readOnly
                    autosize
                    minRows={18}
                    classNames={{ input: 'weekly-report-output' }}
                  />

                  <Text size="sm" c="dimmed">
                    {!weeklyWindowStart || !weeklyWindowEnd
                      ? 'Choose a valid window to generate the report preview.'
                      : weeklyReportEntries.length === 0
                        ? 'No matching updates were found for the current selection and shared filters.'
                        : 'The report includes only comments created inside the selected window and current shared filters.'}
                  </Text>
                </Stack>
              </Card>
            </Stack>
          ) : (
            <Stack gap="lg">
              <div className="section-header">
                <div>
                  <Text className="eyebrow">Administration</Text>
                  <Title order={2} className="form-title">
                    Admin settings
                  </Title>
                  <Text className="form-copy">
                    Manage the tracker values that power owners, projects, workflow
                    statuses, priorities, and reminder cadence options. Changes are
                    saved into the shared database itself.
                  </Text>
                </div>

                <Group gap="sm">
                  <Button
                    variant="default"
                    color="gray"
                    radius="xl"
                    onClick={() => {
                      setOwnersDraft(serializeStringLines(bootstrapData.owners))
                      setProjectsDraft(serializeStringLines(bootstrapData.projects))
                      setDepartmentsDraft(serializeStringLines(bootstrapData.departments))
                      setCategoriesDraft(serializeStringLines(bootstrapData.categories))
                      setCategoryImpactFactorsDraft(
                        normalizeCategoryImpactFactors(
                          bootstrapData.categories,
                          bootstrapData.categoryImpactFactors,
                        ),
                      )
                      setPrioritiesDraft(serializeStringLines(bootstrapData.priorities))
                      setEffortsDraft(serializeStringLines(bootstrapData.efforts))
                      setImpactsDraft(serializeStringLines(bootstrapData.impacts))
                      setStatusesDraft(serializeStringLines(bootstrapData.statuses))
                      setReminderCadencesDraft(
                        serializeReminderCadenceLines(bootstrapData.reminderCadences),
                      )
                      setSettingsError(null)
                      setSettingsConflictError(null)
                      setSettingsConflicts([])
                      setPendingSettingsPayload(null)
                    }}
                  >
                    Reset draft
                  </Button>
                  <Button
                    variant="light"
                    color="blue"
                    radius="xl"
                    onClick={() => void handleSaveSettings()}
                    loading={isSavingSettings}
                    disabled={isBootstrapping}
                  >
                    Save settings
                  </Button>
                </Group>
              </div>

              <Card radius="xl" padding="lg" className="surface-card">
                <Stack gap="sm">
                  <Text fw={700}>Editing guide</Text>
                  <Text size="sm" c="dimmed">
                    Add, edit, or remove values with the controls below. If you
                    remove a value that is still in use, the app will show where it
                    is used and let you replace those occurrences before saving.
                  </Text>
                  {settingsError ? (
                    <Text size="sm" c="red">
                      {settingsError}
                    </Text>
                  ) : null}
                </Stack>
              </Card>

              <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                <AdminTextListEditor
                  title="Owners"
                  singularLabel="Owner"
                  description="People who can own records and quick updates."
                  value={ownersDraft}
                  onChange={setOwnersDraft}
                />
                <AdminTextListEditor
                  title="Projects"
                  singularLabel="Project"
                  description="Workstreams that records can belong to."
                  value={projectsDraft}
                  onChange={setProjectsDraft}
                />
                <AdminTextListEditor
                  title="Departments"
                  singularLabel="Department"
                  description="Teams or departments involved in the work."
                  value={departmentsDraft}
                  onChange={setDepartmentsDraft}
                />
                <AdminCategoryImpactEditor
                  value={categoriesDraft}
                  factors={categoryImpactFactorsDraft}
                  onChange={setCategoriesDraft}
                  onFactorsChange={setCategoryImpactFactorsDraft}
                />
                <AdminTextListEditor
                  title="Priorities"
                  singularLabel="Priority"
                  description="Priority levels shown on lists, records, and boards."
                  value={prioritiesDraft}
                  onChange={setPrioritiesDraft}
                />
                <AdminTextListEditor
                  title="Statuses"
                  singularLabel="Status"
                  description="Workflow columns used by the Records and Board pages."
                  value={statusesDraft}
                  onChange={setStatusesDraft}
                />
                <AdminTextListEditor
                  title="Efforts"
                  singularLabel="Effort"
                  description="Effort values used in the effort-impact matrix."
                  value={effortsDraft}
                  onChange={setEffortsDraft}
                />
                <AdminTextListEditor
                  title="Impacts"
                  singularLabel="Impact"
                  description="Impact values used in prioritization and insights."
                  value={impactsDraft}
                  onChange={setImpactsDraft}
                />
              </SimpleGrid>

              <AdminReminderCadenceEditor
                value={reminderCadencesDraft}
                onChange={setReminderCadencesDraft}
              />
            </Stack>
          )}
        </Paper>
      </div>
    </div>
  )
}

export default App
