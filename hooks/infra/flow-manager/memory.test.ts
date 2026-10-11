import { test, expect } from 'claude-code/testing'
import { DIR, flowFile, step, world } from './fake-world'
import { addMemoryEntry, readMemoryTopic } from './memory'

const XREF = { type: 'memory-cross-references', keyDecisions: [], filesModified: [], filesCreated: [], custom: {} }
const setup = (usage?: unknown) => world({
  [`${DIR}/flow.json`]: flowFile({}, [step({ stepDefinition: usage ? { memoryFileUsage: usage } : {} })]),
  [`${DIR}/memory/_cross-references.json`]: XREF,
})

test('a new topic: the entry, the topic file and the cross-references', async () => {
  const w = setup()
  const result = await addMemoryEntry(w.ports, { flowDir: DIR, stepId: 's1', topic: 'context', info: { a: 1 }, decisions: ['d1'], files: ['f1'] })
  expect(result.files_written).toEqual(['memory/context.json', 'memory/_cross-references.json'])
  const topic = w.json(`${DIR}/memory/context.json`)
  expect(topic.type).toBe('memory-topic-file')
  expect(topic.entries.s1).toMatchObject({ stepName: 'Design', informationProduced: { a: 1 }, decisionsMade: ['d1'], filesModifiedCreated: ['f1'] })
  expect(w.json(`${DIR}/memory/_cross-references.json`)).toMatchObject({ keyDecisions: ['d1'], filesModified: ['f1'] })
})
test('a second entry for the step merges: info is updated, lists grow', async () => {
  const w = setup()
  await addMemoryEntry(w.ports, { flowDir: DIR, stepId: 's1', topic: 'context', info: { a: 1, b: 1 }, decisions: ['d1'] })
  await addMemoryEntry(w.ports, { flowDir: DIR, stepId: 's1', topic: 'context', info: { b: 2 }, decisions: ['d2'], files: ['f2'] })
  expect(w.json(`${DIR}/memory/context.json`).entries.s1).toMatchObject({ informationProduced: { a: 1, b: 2 }, decisionsMade: ['d1', 'd2'], filesModifiedCreated: ['f2'] })
  expect(w.json(`${DIR}/memory/_cross-references.json`).keyDecisions).toEqual(['d1', 'd2'])
})
test('a topic the step may not write is an error', async () => {
  const w = setup({ writeTo: ['context.json'] })
  await expect(addMemoryEntry(w.ports, { flowDir: DIR, stepId: 's1', topic: 'secret' })).rejects.toThrow('is not allowed to write to topic "secret.json"')
  await addMemoryEntry(w.ports, { flowDir: DIR, stepId: 's1', topic: 'context' })
})
test('an empty list of topics means no limit', async () => {
  const w = setup({ writeTo: [], readFrom: [] })
  await addMemoryEntry(w.ports, { flowDir: DIR, stepId: 's1', topic: 'anything' })
  expect((await readMemoryTopic(w.ports, { flowDir: DIR, stepId: 's1', topic: 'anything' })).data).not.toBeNull()
})
test('no memory folder is an error', async () => {
  const w = world({ [`${DIR}/flow.json`]: flowFile() })
  await expect(addMemoryEntry(w.ports, { flowDir: DIR, stepId: 's1', topic: 'x' })).rejects.toThrow('memory/ directory not found')
})
test('read: the topic, or null when it does not exist', async () => {
  const w = setup()
  expect(await readMemoryTopic(w.ports, { flowDir: DIR, stepId: 's1', topic: 'context' })).toEqual({ status: 'ok', topic: 'context', data: null })
  await addMemoryEntry(w.ports, { flowDir: DIR, stepId: 's1', topic: 'context', info: { a: 1 } })
  expect((await readMemoryTopic(w.ports, { flowDir: DIR, stepId: 's1', topic: 'context' })).data.entries.s1.informationProduced).toEqual({ a: 1 })
})
test('read: a step may read the cross-references, and only the topics it lists', async () => {
  const w = setup({ readFrom: ['context.json'] })
  expect((await readMemoryTopic(w.ports, { flowDir: DIR, stepId: 's1', topic: '_cross-references' })).data).toEqual(XREF)
  await expect(readMemoryTopic(w.ports, { flowDir: DIR, stepId: 's1', topic: 'secret' })).rejects.toThrow('is not allowed to read from')
})
test('a repeated call adds no decision or file twice', async () => {
  const w = setup()
  const call = () => addMemoryEntry(w.ports, { flowDir: DIR, stepId: 's1', topic: 'context', decisions: ['d1'], files: ['f1'] })
  await call(); await call()
  expect(w.json(`${DIR}/memory/context.json`).entries.s1).toMatchObject({ decisionsMade: ['d1'], filesModifiedCreated: ['f1'] })
  expect(w.json(`${DIR}/memory/_cross-references.json`)).toMatchObject({ keyDecisions: ['d1'], filesModified: ['f1'] })
})
