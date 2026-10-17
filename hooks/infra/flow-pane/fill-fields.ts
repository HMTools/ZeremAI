import type { TemplateInfo } from './flow-pane'

// Claude fills the Start form from one free text. This file holds the parts that need no model: the question, the reading of the reply, and the merge.

export type Filled = {
  values: Record<string, string> // the form values after the merge
  filled: string[] // fields that were empty and now hold Claude's text
  offers: Record<string, string> // fields the user typed that Claude wants to change: the user answers Replace or Keep
  open: string[] // fields still empty after the merge
}

export function fillQuestion(template: TemplateInfo, purpose: string, values: Record<string, string>, text: string): string {
  const fields = template.fields
    .map(
      f =>
        `  ${f.name}${f.required ? ' *' : ''}: ${f.description}${f.options ? ` (one of: ${f.options.join(', ')}${f.allowOther ? ', or another value' : ''})` : f.example ? ` (e.g. ${f.example})` : ''}`,
    )
    .join('\n')
  const typed = Object.entries(values)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`)
    .join('\n')
  return [
    'Fill the fields of a flow template from the text below. Reply with one JSON object: field name -> text. Leave out a field the text does not cover. Never invent a value.',
    `Template: ${template.name}`,
    ...(purpose ? [`Purpose: ${purpose}`] : []),
    `Fields:\n${fields}`,
    ...(typed ? [`Already typed by the user:\n${typed}`] : []),
    `Text: ${text}`,
  ].join('\n')
}

const listed = (f: TemplateInfo['fields'][number] | undefined, v: string) => !f?.options || f.allowOther || f.options.includes(v)

// The first JSON object in the reply: a model sometimes wraps it in words. A name that is not a field, or a value that is not text, is dropped.
export function parseAnswer(template: TemplateInfo, reply: string): { answer: Record<string, string> } | { error: string } {
  const start = reply.indexOf('{'),
    end = reply.lastIndexOf('}')
  if (start < 0 || end < start) return { error: 'Claude did not answer with field values.' }
  let data: unknown
  try {
    data = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return { error: 'Claude did not answer with field values.' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'Claude did not answer with field values.' }
  const names = new Set(template.fields.map(f => f.name))
  const fields = new Map(template.fields.map(f => [f.name, f]))
  const answer: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) if (names.has(k) && typeof v === 'string' && v.trim() && listed(fields.get(k), v.trim())) answer[k] = v.trim()
  return { answer }
}

export function fillFields(template: TemplateInfo, values: Record<string, string>, answer: Record<string, string>): Filled {
  const next = { ...values },
    filled: string[] = [],
    offers: Record<string, string> = {},
    open: string[] = []
  for (const f of template.fields) {
    const had = (values[f.name] ?? '').trim(),
      said = answer[f.name]
    if (!said) {
      if (!had) open.push(f.name)
      continue
    }
    if (!had) {
      next[f.name] = said
      filled.push(f.name)
    } else if (had !== said) offers[f.name] = said
  }
  return { values: next, filled, offers, open }
}
