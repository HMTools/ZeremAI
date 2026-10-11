import type { ManagerPorts } from '../ports/ports'
import { slash } from './move'
import { fail, locked, ok, readJson, readFlow, writeJson } from './flow-files'
import type { Doc, Result } from './flow-files'

// The improvement findings of every flow, in one folder for each template.
const findingsDir = async (ports: ManagerPorts) => `${slash(String(await ports.files.home()))}/.claude/zeremai/improvement-findings`

async function listNames(ports: ManagerPorts, dir: string): Promise<{ name: string; kind: string }[]> {
  try { return (await ports.files.list(dir)).sort((a, b) => a.name.localeCompare(b.name)) } catch { return [] }
}

export type WriteFindingArgs = { flowDir: string; category: string; title: string; what: string; why: string; impact: string; scope?: string[] }

export const writeFinding = async (ports: ManagerPorts, a: WriteFindingArgs): Promise<Result> => {
  const flow = await readFlow(ports, a.flowDir)
  // A template installed before templateId existed groups under its name.
  const templateKey = flow.metadata.templateId || flow.metadata.template
  const path = `${await findingsDir(ports)}/${templateKey}/${flow.id}.json`
  return locked(path, async () => {
    const data: Doc = (await ports.files.exists(path)) ? await readJson(ports, path) : {
      type: 'improvement-findings-file', templateId: templateKey, template: flow.metadata.template,
      flowId: flow.id, flowName: flow.name, findings: [],
    }
    data.findings.push({
      id: ports.uuid(), flowId: flow.id, flowName: flow.name, template: flow.metadata.template,
      createdAt: ports.now(), category: a.category, title: a.title, what: a.what, why: a.why, impact: a.impact,
      scope: a.scope ?? [], status: 'open',
    })
    await writeJson(ports, path, data)
    return ok(path)
  })
}

export type ListFindingsArgs = { status?: string; templateId?: string }

export async function listFindings(ports: ManagerPorts, a: ListFindingsArgs): Promise<Result> {
  const root = await findingsDir(ports)
  const folders = a.templateId ? [{ name: a.templateId, kind: 'dir' }] : (await listNames(ports, root)).filter(e => e.kind === 'dir')
  const findings: Doc[] = []
  for (const folder of folders) {
    for (const file of (await listNames(ports, `${root}/${folder.name}`)).filter(e => e.name.endsWith('.json'))) {
      const data = await readJson(ports, `${root}/${folder.name}/${file.name}`)
      for (const finding of data.findings ?? []) if (!a.status || finding.status === a.status) findings.push(finding)
    }
  }
  return { status: 'ok', findings }
}

export type FindingStatusArgs = { flowId: string; findingId: string; status: string; notes?: string; filesModified?: string[] }

export async function updateFindingStatus(ports: ManagerPorts, a: FindingStatusArgs): Promise<Result> {
  // A flow id is unique everywhere, so the template folder need not be given: find the folder that holds this flow's file.
  const root = await findingsDir(ports)
  let path: string | undefined
  for (const folder of (await listNames(ports, root)).filter(e => e.kind === 'dir')) {
    const candidate = `${root}/${folder.name}/${a.flowId}.json`
    if (await ports.files.exists(candidate)) { path = candidate; break }
  }
  if (!path) fail(`No findings file for flow ${a.flowId}`)
  const file = path as string
  return locked(file, async () => {
    const data = await readJson(ports, file)
    const finding = (data.findings ?? []).find((f: Doc) => f.id === a.findingId)
    if (!finding) fail(`Finding ${a.findingId} not found in ${file}`)
    finding.status = a.status
    finding.resolution = { resolvedAt: ports.now(), notes: a.notes ?? null, filesModified: a.filesModified ?? [] }
    await writeJson(ports, file, data)
    return ok(file)
  })
}
