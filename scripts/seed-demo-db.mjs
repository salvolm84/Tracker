import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const repoRoot = process.cwd()
const defaultDbPath = path.join(
  repoRoot,
  'src-tauri',
  'target',
  'debug',
  'activity-db.json',
)

const trackerCountArg = Number.parseInt(process.argv[2] ?? '100', 10)
const requestedTrackerCount =
  Number.isFinite(trackerCountArg) && trackerCountArg > 0 ? trackerCountArg : 100
const dbPath = process.argv[3] ?? defaultDbPath
const debugCountArg = Number.parseInt(process.argv[4] ?? '50', 10)
const requestedDebugCount =
  Number.isFinite(debugCountArg) && debugCountArg > 0 ? debugCountArg : 50

const listsDir = path.join(repoRoot, 'src-tauri', 'resources', 'lists')
const referenceNow = new Date('2026-04-15T09:30:00.000Z')
const datasetStart = new Date('2025-11-10T08:00:00.000Z')
const recordHorizonEnd = new Date('2026-04-10T17:00:00.000Z')

const statuses = ['Scheduled', 'Open', 'On Hold', 'Halted', 'Completed']
const priorities = ['Low', 'Normal', 'High', 'Critical']
const efforts = ['Low', 'Mid', 'High']
const impacts = ['Low', 'Mid', 'High']
const reminderCadences = [
  { label: 'None', intervalDays: 0 },
  { label: 'Weekly', intervalDays: 7 },
  { label: 'Biweekly', intervalDays: 14 },
  { label: 'Monthly', intervalDays: 30 },
]
const debugCategories = ['HW', 'SW', 'System']
const debugOutcomes = [
  'Root cause found',
  'Issue reproduced',
  'Workaround identified',
  'Fix identified',
  'Workaround validated',
  'Fix validated',
  'Degraded performance',
]
const demeritValues = ['DEM100', 'DEM40', 'DEM20FS', 'DEM20', 'DEM10FS', 'DEM10', 'DEM1', 'NA']
const labActivities = ['None', 'Bench validation', 'Environmental chamber', 'Vehicle test', 'Regression run']

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

const suppliers = [
  'MicroNova',
  'VoltEdge',
  'SignalForge',
  'LambdaDrive',
  'Apex Semiconductors',
  'Northstar Controls',
  'HelioSense',
  'CircuitWorks',
]

const componentFamilies = [
  'Gate driver',
  'Current sensor',
  'DC/DC converter',
  'CAN transceiver',
  'Power MOSFET',
  'Thermal interface',
  'Resolver interface',
  'EEPROM',
  'Bootloader stack',
  'Diagnostics service',
]

const occurrencePhases = [
  'DV bench',
  'PV vehicle',
  'End-of-line',
  'Supplier PPAP',
  'Regression',
  'Customer return',
]

const debugNarratives = [
  {
    theme: 'thermal drift',
    metric: 'offset drift exceeded 18 mV after 42 minutes at 85 C',
    chart: 'Temperature sweep line plot',
    action: 'added temperature-compensated calibration and tightened chamber dwell timing',
  },
  {
    theme: 'CAN retry burst',
    metric: 'retry rate clustered at 7.8% during bus utilization above 72%',
    chart: 'Bus-load scatter plot',
    action: 'moved diagnostics polling into a staggered schedule',
  },
  {
    theme: 'startup brownout',
    metric: '3 of 12 cold starts dipped below the supervisor threshold for 11 ms',
    chart: 'Cold-crank voltage trace',
    action: 'raised pre-charge delay and updated the supplier validation limit',
  },
  {
    theme: 'firmware timing regression',
    metric: 'control-loop p95 latency increased from 2.4 ms to 3.1 ms',
    chart: 'Latency histogram',
    action: 'removed blocking flash writes from the high-priority task',
  },
  {
    theme: 'connector intermittency',
    metric: 'failure rate dropped from 14% to 2% after retention-force screening',
    chart: 'Pareto bar chart',
    action: 'added incoming inspection for retention force and visual seating',
  },
]

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

const random = createRandom(20260422)

function randomInt(min, max) {
  return min + Math.floor(random() * (max - min + 1))
}

function chance(probability) {
  return random() < probability
}

function sample(items) {
  return items[Math.floor(random() * items.length)]
}

function weightedSample(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let pick = random() * total

  for (const item of items) {
    pick -= item.weight
    if (pick <= 0) {
      return item.value
    }
  }

  return items.at(-1).value
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

function addDays(date, days) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

async function readList(name) {
  const content = await readFile(path.join(listsDir, `${name}.txt`), 'utf8')
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function loadExistingCounts() {
  try {
    const content = await readFile(dbPath, 'utf8')
    const parsed = content.trim() ? JSON.parse(content) : []

    if (Array.isArray(parsed)) {
      return { tracker: parsed.length, debug: 0 }
    }

    return {
      tracker: Array.isArray(parsed.records) ? parsed.records.length : 0,
      debug: Array.isArray(parsed.debugRecords) ? parsed.debugRecords.length : 0,
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { tracker: 0, debug: 0 }
    }

    throw error
  }
}

function buildSettings({ owners, projects, departments, categories }) {
  return {
    owners,
    projects,
    departments,
    categories,
    categoryImpactFactors: Object.fromEntries(
      categories.map((category, index) => [category, Number((1 + index * 0.15).toFixed(2))]),
    ),
    priorities,
    efforts,
    impacts,
    statuses,
    reminderCadences,
  }
}

function buildCommentMessage(record, index, commentIndex) {
  const firstLine = `${sample(commentOpeners)} ${record.projects[0]} remains the main focus.`

  if ((index + commentIndex) % 3 === 0) {
    return `${firstLine}\n${sample(commentClosers)}`
  }

  return `${firstLine} ${sample(commentClosers)}`
}

function buildCommentTimeline(record, index, owners) {
  const timelineStart = addDays(new Date(record.submittedAt), 1)
  const endForTimeline = record.endDate ? new Date(record.endDate) : referenceNow
  const commentWindowEnd = new Date(
    Math.min(referenceNow.getTime(), addDays(endForTimeline, randomInt(7, 35)).getTime()),
  )

  if (commentWindowEnd <= timelineStart || index % 9 === 0) {
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
      author: owners[(index + commentIndex) % owners.length],
      message: buildCommentMessage(record, index, commentIndex),
      attachments: [],
    })
  }

  return comments.sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  )
}

function injectGuaranteedWeeklyCoverage(records, owners) {
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
      author: owners[guaranteed.recordIndex % owners.length],
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

function buildTrackerRecords({ owners, projects, departments, categories }) {
  const records = []

  for (let index = 0; index < requestedTrackerCount; index += 1) {
    const startDate = randomDateBetween(datasetStart, recordHorizonEnd)
    startDate.setUTCHours(0, 0, 0, 0)

    const durationDays = randomInt(5, 45)
    const endDate = addDays(startDate, durationDays)
    const submittedAt = addDays(startDate, -randomInt(1, 8))
    submittedAt.setUTCHours(8 + (index % 8), 10 + ((index * 7) % 45), 0, 0)

    const owner = owners[index % owners.length]
    const chosenProjects = sampleMany(projects, 1, 2)
    const chosenDepartments = sampleMany(departments, 1, 3)
    const chosenCategories = sampleMany(categories, 1, 2)
    const effort = efforts[(index + randomInt(0, 2)) % efforts.length]
    const impact = impacts[(index + randomInt(0, 2)) % impacts.length]
    const priority =
      impact === 'High' && effort === 'High'
        ? sample(['High', 'Critical', 'Critical'])
        : impact === 'High' || effort === 'High'
          ? sample(['Normal', 'High', 'High'])
          : priorities[(index + randomInt(0, 1)) % 2]
    const status = statuses[index % statuses.length]
    const isOpenEnded = status !== 'Completed' && index % 6 === 0

    const record = {
      id: randomUUID(),
      submittedAt: submittedAt.toISOString(),
      title: `${titlePrefixes[index % titlePrefixes.length]} ${titleSuffixes[(index * 3) % titleSuffixes.length]}`,
      owner,
      projects: chosenProjects,
      startDate: isoDate(startDate),
      endDate: isOpenEnded ? '' : isoDate(endDate),
      departments: chosenDepartments,
      description: `${descriptionStarters[index % descriptionStarters.length]} Focus areas included ${chosenProjects.join(', ').toLowerCase()} with ${chosenDepartments.join(', ').toLowerCase()} support.`,
      effort,
      impact,
      priority,
      status,
      reminderCadence: 'None',
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
      labActivity: labActivities[index % labActivities.length],
    }

    record.comments = buildCommentTimeline(record, index, owners)
    for (const comment of record.comments) {
      record.history.push({
        id: randomUUID(),
        createdAt: comment.createdAt,
        kind: 'comment_added',
        message: 'Comment added',
      })
    }
    record.lastModifiedAt = record.comments.at(-1)?.createdAt ?? record.submittedAt
    records.push(record)
  }

  injectGuaranteedWeeklyCoverage(records, owners)

  return records.sort(
    (left, right) =>
      new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
  )
}

function buildSupplierRatings(index, category) {
  const base =
    category.includes('HW') ? 3.4 : category.includes('SW') ? 3.8 : 3.6
  return [
    { label: 'Responsiveness', rating: Number(Math.min(5, base + random() * 1.1).toFixed(1)) },
    { label: 'Evidence quality', rating: Number(Math.min(5, base - 0.2 + random() * 1.3).toFixed(1)) },
    { label: 'Containment speed', rating: Number(Math.min(5, base - 0.4 + random() * 1.5).toFixed(1)) },
    { label: 'Fix robustness', rating: Number(Math.min(5, base - 0.1 + random() * 1.2).toFixed(1)) },
  ].map((entry) => ({
    ...entry,
    rating: Number(Math.max(1, entry.rating - (index % 11 === 0 ? 0.8 : 0)).toFixed(1)),
  }))
}

function buildDebugLessons({ narrative, supplier, component, phase, index }) {
  const improvement = 18 + (index % 9) * 4
  const recurrence = Math.max(1, 17 - (index % 7) * 2)

  return [
    {
      id: randomUUID(),
      category: 'Insight',
      text: `${narrative.chart}: ${supplier} ${component.toLowerCase()} events form a clear cluster in ${phase}; ${narrative.metric}.`,
      attachments: [],
    },
    {
      id: randomUUID(),
      category: index % 4 === 0 ? 'Risk' : 'Process',
      text: `Control-chart trend shows ${improvement}% containment improvement after the corrective action, with residual recurrence at ${recurrence}% in the latest validation batch.`,
      attachments: [],
    },
    {
      id: randomUUID(),
      category: index % 5 === 0 ? 'Tool' : 'Success',
      text: `Recommended dashboard view: plot demerit by supplier and occurrence phase, then overlay fix-validation status to expose repeat escapes before release approval.`,
      attachments: [],
    },
  ]
}

function buildDebugRecords({ projects, departments, trackerRecords }) {
  const projectWeights = projects.map((project, index) => ({
    value: project,
    weight: [16, 13, 11, 10][index] ?? 8,
  }))
  const departmentWeights = departments.map((department, index) => ({
    value: department,
    weight: [18, 9, 7, 6, 10][index] ?? 5,
  }))
  const supplierWeights = suppliers.map((supplier, index) => ({
    value: supplier,
    weight: [13, 11, 8, 7, 5, 4, 3, 2][index] ?? 1,
  }))

  const records = []

  for (let index = 0; index < requestedDebugCount; index += 1) {
    const startDate = randomDateBetween(datasetStart, recordHorizonEnd)
    startDate.setUTCHours(0, 0, 0, 0)
    const endDate = addDays(startDate, randomInt(2, 28))
    const submittedAt = addDays(startDate, -randomInt(0, 5))
    submittedAt.setUTCHours(7 + (index % 9), 5 + ((index * 13) % 50), 0, 0)
    const lastModifiedAt = addDays(endDate, randomInt(1, 9))
    lastModifiedAt.setUTCHours(11 + (index % 6), 15 + ((index * 5) % 40), 0, 0)

    const narrative = debugNarratives[index % debugNarratives.length]
    const category =
      index % 10 === 0
        ? ['HW', 'System']
        : index % 7 === 0
          ? ['SW', 'System']
          : [debugCategories[index % debugCategories.length]]
    const supplier = weightedSample(supplierWeights)
    const component = componentFamilies[index % componentFamilies.length]
    const phase = occurrencePhases[index % occurrencePhases.length]
    const chosenProjects = [
      weightedSample(projectWeights),
      ...(chance(0.28) ? [weightedSample(projectWeights)] : []),
    ].filter((value, valueIndex, values) => values.indexOf(value) === valueIndex)
    const chosenDepartments = [
      weightedSample(departmentWeights),
      ...(chance(0.35) ? [weightedSample(departmentWeights)] : []),
    ].filter((value, valueIndex, values) => values.indexOf(value) === valueIndex)
    const outcome =
      index % 5 === 0
        ? ['Issue reproduced', 'Root cause found', 'Fix identified']
        : index % 4 === 0
          ? ['Workaround identified', 'Workaround validated']
          : [debugOutcomes[(index + randomInt(0, 3)) % debugOutcomes.length]]
    const linkedActivityIds = sampleMany(
      trackerRecords.slice(0, Math.min(trackerRecords.length, 30)).map((record) => record.id),
      index % 3 === 0 ? 1 : 0,
      index % 3 === 0 ? 2 : 1,
    )

    records.push({
      id: randomUUID(),
      submittedAt: submittedAt.toISOString(),
      projects: chosenProjects,
      startDate: isoDate(startDate),
      endDate: isoDate(endDate),
      category,
      description: [
        `Significant debug on ${component.toLowerCase()} from ${supplier}: ${narrative.theme}.`,
        `${narrative.metric}; analytics review used a ${narrative.chart.toLowerCase()} split by supplier, project, and occurrence phase.`,
        `Containment: ${narrative.action}. Validation sample size ${24 + (index % 8) * 6}, residual escape estimate ${(1.5 + (index % 6) * 0.7).toFixed(1)}%.`,
      ].join('\n'),
      attachments: [],
      supplier,
      component,
      departments: chosenDepartments,
      supplierRating: buildSupplierRatings(index, category),
      outcome,
      lastModifiedAt: lastModifiedAt.toISOString(),
      occurrencePhase: phase,
      demerit: demeritValues[index % demeritValues.length],
      linkedActivityIds,
      lessonsLearnt: buildDebugLessons({ narrative, supplier, component, phase, index }),
    })
  }

  return records.sort(
    (left, right) =>
      new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
  )
}

async function main() {
  const [owners, projects, departments, categories, previousCounts] = await Promise.all([
    readList('owners'),
    readList('projects'),
    readList('departments'),
    readList('categories'),
    loadExistingCounts(),
  ])

  const settings = buildSettings({ owners, projects, departments, categories })
  const records = buildTrackerRecords({ owners, projects, departments, categories })
  const debugRecords = buildDebugRecords({ projects, departments, trackerRecords: records })
  const database = {
    schemaVersion: 1,
    revision: 1,
    settings,
    records,
    debugRecords,
    debugSettings: {
      categories: debugCategories,
      outcomeOptions: debugOutcomes,
    },
  }

  await mkdir(path.dirname(dbPath), { recursive: true })
  await writeFile(dbPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8')

  const commentCount = records.reduce((sum, record) => sum + record.comments.length, 0)
  const linkedDebugCount = debugRecords.filter((record) => record.linkedActivityIds.length > 0).length
  const lessonCount = debugRecords.reduce((sum, record) => sum + record.lessonsLearnt.length, 0)

  console.log(`Replaced database at ${dbPath}`)
  console.log(`Previous tracker/debug count: ${previousCounts.tracker}/${previousCounts.debug}`)
  console.log(`New tracker/debug count: ${records.length}/${debugRecords.length}`)
  console.log(`Generated tracker comments: ${commentCount}`)
  console.log(`Generated linked debug entries: ${linkedDebugCount}`)
  console.log(`Generated debug lessons/insights: ${lessonCount}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
