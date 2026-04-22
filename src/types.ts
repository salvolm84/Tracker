export interface ReminderCadenceOption {
  label: string
  intervalDays: number
}

export interface TrackerSettings {
  owners: string[]
  projects: string[]
  departments: string[]
  categories: string[]
  categoryImpactFactors: Record<string, number>
  priorities: string[]
  efforts: string[]
  impacts: string[]
  statuses: string[]
  reminderCadences: ReminderCadenceOption[]
}

export interface BootstrapPayload {
  owners: string[]
  projects: string[]
  departments: string[]
  categories: string[]
  categoryImpactFactors: Record<string, number>
  priorities: string[]
  efforts: string[]
  impacts: string[]
  statuses: string[]
  reminderCadences: ReminderCadenceOption[]
  dbPath: string
  dbRevision: number
  recordCount: number
}

export interface CountBucket {
  label: string
  count: number
}

export interface DatabaseStats {
  recordCount: number
  uniqueOwners: number
  uniqueProjects: number
  uniqueDepartments: number
  uniqueCategories: number
  averageDurationDays: number
  latestSubmittedAt: string | null
  upcomingEndDate: string | null
  priorityCounts: CountBucket[]
  effortCounts: CountBucket[]
  impactCounts: CountBucket[]
  topOwners: CountBucket[]
  topProjects: CountBucket[]
}

export interface StatsFilters {
  searchTerm: string
  owners: string[]
  departments: string[]
  categories: string[]
  projects: string[]
  priorities: string[]
  statuses: ActivityStatus[]
  efforts: string[]
  impacts: string[]
}

export interface AttachmentPayload {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  storageId?: string
  base64Data?: string
}

export interface AttachmentData extends AttachmentPayload {
  base64Data: string
}

export type ReminderCadence = string

export type ActivityStatus = string

export interface RecordHistoryEntry {
  id: string
  createdAt: string
  kind: string
  message: string
}

export interface RecordComment {
  id: string
  createdAt: string
  message: string
  attachments: AttachmentPayload[]
}

export interface ActivityRecord {
  id: string
  submittedAt: string
  title: string
  owner: string
  projects: string[]
  startDate: string
  endDate: string
  departments: string[]
  description: string
  effort: string
  impact: string
  priority: string
  status: ActivityStatus
  reminderCadence: ReminderCadence
  categories: string[]
  attachments: AttachmentPayload[]
  comments: RecordComment[]
  history: RecordHistoryEntry[]
  lastModifiedAt: string
  labActivity: string
}

export interface ActivityPayload {
  title: string
  owner: string
  projects: string[]
  startDate: string
  endDate: string
  departments: string[]
  description: string
  effort: string
  impact: string
  priority: string
  status: ActivityStatus
  reminderCadence: ReminderCadence
  categories: string[]
  attachments: AttachmentPayload[]
  labActivity: string
  expectedLastModifiedAt?: string | null
}

export interface SubmitResult {
  dbPath: string
  dbRevision: number
  recordCount: number
  backupPath?: string
}

export interface DatabaseBackup {
  fileName: string
  path: string
  modifiedAt: string
  sizeBytes: number
}

export interface DatabaseDocument {
  settings: TrackerSettings
  records: ActivityRecord[]
}

export interface AppendCommentPayload {
  message: string
  attachments?: AttachmentPayload[]
  expectedLastModifiedAt?: string | null
}

export interface UpdateCommentPayload {
  message: string
  attachments?: AttachmentPayload[]
  expectedLastModifiedAt?: string | null
}

export interface SettingsRelabelPayload {
  field: string
  from: string
  to: string
}

export interface AttachmentStorageStats {
  fileCount: number
  totalSizeBytes: number
}

export interface QuickUpdatePayload {
  owner?: string | null
  status?: ActivityStatus | null
  reminderCadence?: ReminderCadence | null
  expectedLastModifiedAt?: string | null
}

export interface DebugSettings {
  categories: string[]
  outcomeOptions: string[]
}

export interface SupplierRatingEntry {
  label: string
  rating: number
}

export interface DebugRecord {
  id: string
  submittedAt: string
  projects: string[]
  startDate: string
  endDate: string
  category: string[]
  description: string
  attachments: AttachmentPayload[]
  supplier: string
  component: string
  departments: string[]
  supplierRating: SupplierRatingEntry[]
  outcome: string[]
  lastModifiedAt: string
  occurrencePhase: string
  demerit: number
  linkedActivityIds: string[]
  lessonsLearnt: LessonLearnt[]
}

export interface DebugPayload {
  projects: string[]
  startDate: string
  endDate: string
  category: string[]
  description: string
  attachments: AttachmentPayload[]
  supplier: string
  component: string
  departments: string[]
  supplierRating: SupplierRatingEntry[]
  outcome: string[]
  occurrencePhase: string
  demerit: number
  linkedActivityIds: string[]
  lessonsLearnt: LessonLearnt[]
  expectedLastModifiedAt?: string | null
}

export interface DebugFormValues {
  projects: string[]
  startDate: Date | null
  endDate: Date | null
  category: string[]
  description: string
  attachments: AttachmentPayload[]
  supplier: string
  component: string
  departments: string[]
  supplierRating: SupplierRatingEntry[]
  outcome: string[]
  occurrencePhase: string
  demerit: number
  linkedActivityIds: string[]
  lessonsLearnt: LessonLearnt[]
}

export interface ActivityFormValues {
  title: string
  owner: string | null
  projects: string[]
  startDate: Date | null
  endDate: Date | null
  departments: string[]
  description: string
  effort: string | null
  impact: string | null
  priority: string | null
  status: ActivityStatus | null
  reminderCadence: ReminderCadence | null
  categories: string[]
  attachments: AttachmentPayload[]
  labActivity: string
}

export interface LessonLearnt {
  id: string
  category: string
  text: string
  attachments: AttachmentPayload[]
}
