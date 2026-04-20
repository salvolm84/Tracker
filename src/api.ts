import { invoke } from '@tauri-apps/api/core'
import type {
  AttachmentPayload,
  AttachmentData,
  AttachmentStorageStats,
  ActivityRecord,
  ActivityPayload,
  AppendCommentPayload,
  BootstrapPayload,
  DatabaseBackup,
  DatabaseDocument,
  DatabaseStats,
  QuickUpdatePayload,
  ReminderCadenceOption,
  SettingsRelabelPayload,
  StatsFilters,
  SubmitResult,
  TrackerSettings,
  UpdateCommentPayload,
} from './types'

export const defaultReminderCadenceOptions: ReminderCadenceOption[] = [
  { label: 'None', intervalDays: 0 },
  { label: 'Weekly', intervalDays: 7 },
  { label: 'Biweekly', intervalDays: 14 },
  { label: 'Monthly', intervalDays: 30 },
]

export const defaultTrackerSettings: TrackerSettings = {
  owners: ['Alice Bianchi', 'Marco Rossi', 'Sara Conti'],
  projects: [
    'Apollo Rollout',
    'Customer Portal Refresh',
    'Operations Insight Hub',
  ],
  departments: ['Engineering', 'Operations', 'Finance', 'Customer Success'],
  categories: ['Automation', 'Reporting', 'Release', 'Research'],
  categoryImpactFactors: {
    Automation: 1,
    Reporting: 1,
    Release: 1,
    Research: 1,
  },
  priorities: ['Low', 'Mid', 'High'],
  efforts: ['Low', 'Mid', 'High'],
  impacts: ['Low', 'Mid', 'High'],
  statuses: ['Scheduled', 'Open', 'On Hold', 'Halted', 'Completed'],
  reminderCadences: defaultReminderCadenceOptions,
}

export const fallbackBootstrap: BootstrapPayload = {
  ...defaultTrackerSettings,
  dbPath: 'Desktop preview mode: launch with Tauri to enable file writes',
  dbRevision: 0,
  recordCount: 0,
}

export async function bootstrapForm() {
  return invoke<BootstrapPayload>('bootstrap_form')
}

export async function getDatabaseStats(filters?: StatsFilters) {
  return invoke<DatabaseStats>('get_database_stats', {
    filters: filters ?? {
      searchTerm: '',
      owners: [],
      departments: [],
      categories: [],
      projects: [],
      priorities: [],
      statuses: [],
      efforts: [],
      impacts: [],
    },
  })
}

export async function getActivityRecords() {
  return invoke<ActivityRecord[]>('get_activity_records')
}

export async function listDatabaseBackups() {
  return invoke<DatabaseBackup[]>('list_database_backups')
}

export async function getAttachmentStorageStats() {
  return invoke<AttachmentStorageStats>('get_attachment_storage_stats')
}

export async function updateTrackerSettings(
  payload: TrackerSettings,
  expectedRevision?: number,
) {
  return invoke<SubmitResult>('update_tracker_settings', {
    payload,
    expectedRevision: expectedRevision ?? null,
  })
}

export async function relabelTrackerSettings(
  payload: TrackerSettings,
  replacements: SettingsRelabelPayload[],
  expectedRevision?: number,
) {
  return invoke<SubmitResult>('relabel_tracker_settings', {
    payload,
    replacements,
    expectedRevision: expectedRevision ?? null,
  })
}

export async function readAttachmentsFromPaths(paths: string[]) {
  return invoke<AttachmentPayload[]>('read_attachments_from_paths', { paths })
}

export async function readAttachmentData(
  recordId: string,
  attachmentId: string,
  commentId?: string | null,
) {
  return invoke<AttachmentData>('read_attachment_data', {
    recordId,
    attachmentId,
    commentId: commentId ?? null,
  })
}

export async function submitActivity(payload: ActivityPayload) {
  return invoke<SubmitResult>('submit_activity', { payload })
}

export async function updateActivity(recordId: string, payload: ActivityPayload) {
  return invoke<SubmitResult>('update_activity', { recordId, payload })
}

export async function quickUpdateActivity(
  recordId: string,
  payload: QuickUpdatePayload,
) {
  return invoke<SubmitResult>('quick_update_activity', { recordId, payload })
}

export async function appendActivityComment(
  recordId: string,
  payload: AppendCommentPayload,
) {
  return invoke<SubmitResult>('append_activity_comment', { recordId, payload })
}

export async function updateActivityComment(
  recordId: string,
  commentId: string,
  payload: UpdateCommentPayload,
) {
  return invoke<SubmitResult>('update_activity_comment', {
    recordId,
    commentId,
    payload,
  })
}

export async function deleteActivityComment(
  recordId: string,
  commentId: string,
  expectedLastModifiedAt?: string | null,
) {
  return invoke<SubmitResult>('delete_activity_comment', {
    recordId,
    commentId,
    expectedLastModifiedAt: expectedLastModifiedAt ?? null,
  })
}

export async function replaceDatabaseRecords(
  records: ActivityRecord[],
  settings?: TrackerSettings,
) {
  return invoke<SubmitResult>('replace_database_records', { records, settings: settings ?? null })
}

export async function restoreDatabaseBackup(backupPath: string) {
  return invoke<SubmitResult>('restore_database_backup', { backupPath })
}

export function buildDatabaseDocument(
  settings: TrackerSettings,
  records: ActivityRecord[],
): DatabaseDocument {
  return {
    settings,
    records,
  }
}
