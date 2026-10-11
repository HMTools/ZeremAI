import type { ManagerPorts } from '../ports/ports'
import { fail, locked, ok, readJson, readFlow, stepName, writeJson } from './flow-files'
import type { Doc, Result } from './flow-files'

// A repeated call must not add the same decision or file twice.
const union = (old: string[] | undefined, added: string[]) => [...new Set([...(old ?? []), ...added])]

// A step may read and write only the topics its definition lists. An empty or old-format list means no limit.
async function validateTopicAccess(ports: ManagerPorts, dir: string, stepId: string, topic: string, access: 'readFrom' | 'writeTo'): Promise<void> {
  if (topic === '_cross-references') return
  const flow = await readFlow(ports, dir)
  const allowed = flow.steps.find((s: Doc) => s.id === stepId)?.stepDefinition?.memoryFileUsage?.[access]
  if (!Array.isArray(allowed) || allowed.length === 0) return
  if (allowed.includes(`${topic}.json`) || allowed.includes(topic)) return
  const label = access === 'writeTo' ? 'write to' : 'read from'
  fail(`Step "${stepName(flow, stepId)}" is not allowed to ${label} topic "${topic}.json". Allowed ${access} topics: ${JSON.stringify(allowed)}`)
}

async function memoryDir(ports: ManagerPorts, dir: string): Promise<string> {
  if (!(await ports.files.exists(`${dir}/memory`))) fail(`memory/ directory not found in ${dir}`)
  return `${dir}/memory`
}

export type AddMemoryArgs = { flowDir: string; stepId: string; topic: string; info?: Doc; decisions?: string[]; files?: string[] }

export const addMemoryEntry = (ports: ManagerPorts, a: AddMemoryArgs): Promise<Result> => locked(a.flowDir, async () => {
  const memory = await memoryDir(ports, a.flowDir)
  await validateTopicAccess(ports, a.flowDir, a.stepId, a.topic, 'writeTo')
  const info = a.info ?? {}, decisions = a.decisions ?? [], files = a.files ?? []
  const now = ports.now()
  const topicPath = `${memory}/${a.topic}.json`
  const topic: Doc = (await ports.files.exists(topicPath))
    ? await readJson(ports, topicPath)
    : { type: 'memory-topic-file', topic: a.topic, lastUpdated: now, entries: {} }
  const existing = topic.entries[a.stepId]
  if (existing) {
    existing.informationProduced = { ...existing.informationProduced, ...info }
    existing.decisionsMade = union(existing.decisionsMade, decisions)
    existing.filesModifiedCreated = union(existing.filesModifiedCreated, files)
    existing.updatedAt = now
  } else {
    topic.entries[a.stepId] = {
      stepName: stepName(await readFlow(ports, a.flowDir), a.stepId),
      informationProduced: info, decisionsMade: decisions, filesModifiedCreated: files, updatedAt: now,
    }
  }
  topic.lastUpdated = now
  await writeJson(ports, topicPath, topic)

  // The cross-reference file gathers the decisions and files of every topic.
  const xrefPath = `${memory}/_cross-references.json`
  const xref: Doc = (await ports.files.exists(xrefPath))
    ? await readJson(ports, xrefPath)
    : { type: 'memory-cross-references', keyDecisions: [], filesModified: [], filesCreated: [], custom: {} }
  xref.keyDecisions = union(xref.keyDecisions, decisions)
  xref.filesModified = union(xref.filesModified, files)
  await writeJson(ports, xrefPath, xref)
  return ok(`memory/${a.topic}.json`, 'memory/_cross-references.json')
})

export type ReadMemoryArgs = { flowDir: string; stepId: string; topic: string }

export const readMemoryTopic = async (ports: ManagerPorts, a: ReadMemoryArgs): Promise<Result> => {
  const memory = await memoryDir(ports, a.flowDir)
  await validateTopicAccess(ports, a.flowDir, a.stepId, a.topic, 'readFrom')
  const path = `${memory}/${a.topic}.json`
  return { status: 'ok', topic: a.topic, data: (await ports.files.exists(path)) ? await readJson(ports, path) : null }
}
