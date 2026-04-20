import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const countArg = Number.parseInt(process.argv[2] ?? '64', 10)
const requestedCount = Number.isFinite(countArg) && countArg > 0 ? countArg : 64
const dbPath =
  process.argv[3] ??
  path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'com.salvolm.tracker',
    'tracker-db',
    'activity-db.json',
  )

const repoRoot = process.cwd()
const listsDir = path.join(repoRoot, 'src-tauri', 'resources', 'lists')
const referenceNow = new Date('2026-04-15T09:30:00.000Z')
const datasetStart = new Date('2025-11-10T08:00:00.000Z')
const recordHorizonEnd = new Date('2026-04-10T17:00:00.000Z')

const titlePrefixes = [
  'Workflow refresh',
  'Release coordination',
  'Quarter close reporting',
  'Customer rollout',
  'Automation enablement',
  'Platform cleanup',
  'Risk mitigation',
  'Support handoff',
  'Data quality sweep',
  'Operations uplift',
]

const titleSuffixes = [
  'for regional expansion',
  'for leadership review',
  'for cross-team delivery',
  'for service migration',
  'for backlog stabilization',
  'for onboarding readiness',
  'for weekly planning',
  'for audit follow-up',
  'for launch preparedness',
  'for stakeholder alignment',
]

const descriptionStarters = [
  'Coordinated the next phase of work to keep execution aligned across teams.',
  'Documented the current state, blockers, and decisions needed for follow-through.',
  'Prepared the operational handoff required to move the activity into the next stage.',
  'Reviewed the latest signals and refined the scope for the upcoming iteration.',
  'Consolidated feedback and clarified ownership for the remaining actions.',
]

const commentOpeners = [
  'Confirmed the latest checkpoint with the involved teams.',
  'Closed the loop on the pending follow-up from the previous update.',
  'Captured a fresh status update after the review call.',
  'Documented the newest delivery note for the shared timeline.',
  'Aligned the remaining actions with the current status and owners.',
]

const commentClosers = [
  'Next step is scheduled for the following review window.',
  'No change to scope, but sequencing was adjusted.',
  'Dependencies were rechecked and are being tracked.',
  'The update was shared with the relevant stakeholders.',
  'The board and overview should now reflect the latest position.',
]

const statuses = ['Scheduled', 'Open', 'On Hold', 'Halted', 'Completed']
const reminderCadences = ['None', 'Weekly', 'Biweekly', 'Monthly']
const priorities = ['Low', 'Mid', 'High']
const efforts = ['Low', 'Mid', 'High']
const impacts = ['Low', 'Mid', 'High']

function createRandom(seed) {
  let state = seed >>> 0

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const random = createRandom(20260415)

function randomInt(min, max) {
  return min + Math.floor(random() * (max - min + 1))
}

function chance(probability) {
  return random() < probability
}

function sample(items) {
  return items[Math.floor(random() * items.length)]
}

function sampleMany(items, min, max) {
  const target = Math.min(items.length, randomInt(min, max))
  const pool = [...items]
  const picked = []

  while (pool.length > 0 && picked.length < target) {
    const index = Math.floor(random() * pool.length)
    picked.push(pool.splice(index, 1)[0])
  }

  return picked
}

function randomDateBetween(start, end) {
  const startTime = start.getTime()
  const endTime = end.getTime()
  return new Date(startTime + random() * (endTime - startTime))
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function buildTextAttachment(fileName, body, mimeType = 'text/plain') {
  return {
    fileName,
    mimeType,
    sizeBytes: Buffer.byteLength(body),
    base64Data: Buffer.from(body, 'utf8').toString('base64'),
  }
}

function buildRecordAttachments(record, index) {
  const attachments = []

  if (chance(0.42)) {
    attachments.push(
      buildTextAttachment(
        `${record.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}-brief.txt`,
        [
          `Record: ${record.title}`,
          `Owner: ${record.owner}`,
          `Status: ${record.status}`,
          `Projects: ${record.projects.join(', ')}`,
          `Departments: ${record.departments.join(', ')}`,
        ].join('\n'),
      ),
    )
  }

  if (chance(0.18)) {
    attachments.push(
      buildTextAttachment(
        `tracker-snapshot-${String(index + 1).padStart(2, '0')}.json`,
        JSON.stringify(
          {
            priority: record.priority,
            effort: record.effort,
            impact: record.impact,
            categories: record.categories,
          },
          null,
          2,
        ),
        'application/json',
      ),
    )
  }

  return attachments
}

function buildCommentMessage(record, index, commentIndex) {
  const firstLine = `${sample(commentOpeners)} ${record.projects[0]} remains the main focus.`

  if ((index + commentIndex) % 3 === 0) {
    return `${firstLine}\n${sample(commentClosers)}`
  }

  return `${firstLine} ${sample(commentClosers)}`
}

async function readList(name) {
  const content = await readFile(path.join(listsDir, `${name}.txt`), 'utf8')
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function loadExistingRecordCount() {
  try {
    const content = await readFile(dbPath, 'utf8')
    const records = content.trim() ? JSON.parse(content) : []
    return Array.isArray(records) ? records.length : 0
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return 0
    }

    throw error
  }
}

function buildCommentTimeline(record, index) {
  const timelineStart = new Date(new Date(record.submittedAt).getTime() + 24 * 60 * 60 * 1000)
  const commentWindowEnd = new Date(
    Math.min(
      referenceNow.getTime(),
      new Date(record.endDate).getTime() + randomInt(7, 35) * 24 * 60 * 60 * 1000,
    ),
  )

  if (commentWindowEnd <= timelineStart || index % 7 === 0) {
    return []
  }

  const commentCount =
    record.status === 'Scheduled'
      ? randomInt(0, 2)
      : record.status === 'Completed'
        ? randomInt(2, 4)
        : randomInt(1, 4)

  const comments = []
  const spanMs = Math.max(commentWindowEnd.getTime() - timelineStart.getTime(), 1)

  for (let commentIndex = 0; commentIndex < commentCount; commentIndex += 1) {
    const progress = (commentIndex + 1) / (commentCount + 1)
    const jitter = (random() - 0.5) * 0.18
    const timestamp = new Date(
      timelineStart.getTime() + spanMs * Math.min(Math.max(progress + jitter, 0.05), 0.95),
    )
    timestamp.setUTCHours(9 + ((index + commentIndex) % 7), 10 + ((index * 11 + commentIndex * 9) % 45), 0, 0)

    comments.push({
      id: randomUUID(),
      createdAt: timestamp.toISOString(),
      message: buildCommentMessage(record, index, commentIndex),
      attachments: [],
    })
  }

  return comments.sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  )
}

function injectGuaranteedWeeklyCoverage(records) {
  const guaranteedComments = [
    {
      recordIndex: 0,
      createdAt: '2026-01-06T10:15:00.000Z',
      message:
        'Validated the first January handoff and confirmed the weekly report should pick this up.\nFollow-up remains assigned for the next operating review.',
    },
    {
      recordIndex: 1,
      createdAt: '2026-01-08T14:20:00.000Z',
      message:
        'Added a second update in CWK 2 to make sure multiple activities appear in the report.',
    },
    {
      recordIndex: 2,
      createdAt: '2026-03-18T09:40:00.000Z',
      message:
        'Captured a mid-March progress note so custom date-range reporting has a clean test case.',
    },
    {
      recordIndex: 3,
      createdAt: '2026-04-14T11:05:00.000Z',
      message:
        'Logged a current-week update to make the Weekly page useful immediately after seeding.',
    },
  ]

  for (const guaranteed of guaranteedComments) {
    const record = records[guaranteed.recordIndex]
    if (!record) {
      continue
    }

    record.comments.push({
      id: randomUUID(),
      createdAt: guaranteed.createdAt,
      message: guaranteed.message,
      attachments: [],
    })

    record.comments.sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    )
    record.lastModifiedAt = record.comments.at(-1)?.createdAt ?? record.submittedAt
    record.history.push({
      id: randomUUID(),
      createdAt: guaranteed.createdAt,
      kind: 'comment_added',
      message: 'Comment added',
    })
  }
}

async function main() {
  const [owners, projects, departments, categories, previousCount] = await Promise.all([
    readList('owners'),
    readList('projects'),
    readList('departments'),
    readList('categories'),
    loadExistingRecordCount(),
  ])

  const generatedRecords = []

  for (let index = 0; index < requestedCount; index += 1) {
    const startDate = randomDateBetween(datasetStart, recordHorizonEnd)
    startDate.setUTCHours(0, 0, 0, 0)

    const durationDays = randomInt(5, 45)
    const endDate = new Date(startDate)
    endDate.setUTCDate(endDate.getUTCDate() + durationDays)

    const submittedAt = new Date(startDate)
    submittedAt.setUTCDate(submittedAt.getUTCDate() - randomInt(1, 8))
    submittedAt.setUTCHours(8 + (index % 8), 10 + ((index * 7) % 45), 0, 0)

    const owner = owners[index % owners.length]
    const chosenProjects = sampleMany(projects, 1, 2)
    const chosenDepartments = sampleMany(departments, 1, 3)
    const chosenCategories = sampleMany(categories, 1, 2)
    const effort = efforts[(index + randomInt(0, 2)) % efforts.length]
    const impact = impacts[(index + randomInt(0, 2)) % impacts.length]
    const priority =
      impact === 'High' || effort === 'High'
        ? sample(['Mid', 'High', 'High'])
        : priorities[(index + randomInt(0, 2)) % priorities.length]
    const status = statuses[index % statuses.length]
    const reminderCadence =
      status === 'Completed' ? 'None' : reminderCadences[index % reminderCadences.length]

    const record = {
      id: randomUUID(),
      submittedAt: submittedAt.toISOString(),
      title: `${titlePrefixes[index % titlePrefixes.length]} ${titleSuffixes[(index * 3) % titleSuffixes.length]}`,
      owner,
      projects: chosenProjects,
      startDate: isoDate(startDate),
      endDate: isoDate(endDate),
      departments: chosenDepartments,
      description: `${descriptionStarters[index % descriptionStarters.length]} Focus areas included ${chosenProjects.join(', ').toLowerCase()} with ${chosenDepartments.join(', ').toLowerCase()} support.`,
      effort,
      impact,
      priority,
      status,
      reminderCadence,
      categories: chosenCategories,
      attachments: [],
      comments: [],
      history: [
        {
          id: randomUUID(),
          createdAt: submittedAt.toISOString(),
          kind: 'created',
          message: 'Record created',
        },
      ],
      lastModifiedAt: submittedAt.toISOString(),
    }

    record.attachments = buildRecordAttachments(record, index)
    record.comments = buildCommentTimeline(record, index)
    if (record.comments.length > 0) {
      for (const comment of record.comments) {
        record.history.push({
          id: randomUUID(),
          createdAt: comment.createdAt,
          kind: 'comment_added',
          message: 'Comment added',
        })
      }
    }
    record.lastModifiedAt = record.comments.at(-1)?.createdAt ?? record.submittedAt
    generatedRecords.push(record)
  }

  injectGuaranteedWeeklyCoverage(generatedRecords)

  const sortedRecords = generatedRecords.sort(
    (left, right) =>
      new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
  )

  await mkdir(path.dirname(dbPath), { recursive: true })
  await writeFile(dbPath, `${JSON.stringify(sortedRecords, null, 2)}\n`, 'utf8')

  const commentCount = sortedRecords.reduce(
    (sum, record) => sum + record.comments.length,
    0,
  )
  const attachmentCount = sortedRecords.reduce(
    (sum, record) => sum + record.attachments.length,
    0,
  )

  console.log(`Replaced database at ${dbPath}`)
  console.log(`Previous count: ${previousCount}`)
  console.log(`New record count: ${sortedRecords.length}`)
  console.log(`Generated comments: ${commentCount}`)
  console.log(`Generated attachments: ${attachmentCount}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
