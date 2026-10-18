import { test, expect } from 'claude-code/testing'
import { fillFields, fillQuestion, parseAnswer } from './fill-fields'
import type { TemplateInfo } from './flow-pane'

const template = {
  name: 'tpl',
  fields: [
    { name: 'a', required: true, example: '', description: 'first' },
    { name: 'b', required: true, example: 'x', description: 'second' },
    { name: 'c', required: false, example: '', description: 'third' },
  ],
} as TemplateInfo

test('the reply is read from inside words; unknown names and non-text values are dropped', () => {
  expect(parseAnswer(template, 'Here you go: {"a":" one ","zzz":"no","b":5,"c":""} done')).toEqual({ answer: { a: 'one' } })
  expect(parseAnswer(template, 'no json')).toHaveProperty('error')
  expect(parseAnswer(template, '{bad}')).toHaveProperty('error')
  expect(parseAnswer(template, '[1]')).toHaveProperty('error')
})

test('an empty field is filled, a typed one gets an offer, a field left out stays open', () => {
  const r = fillFields(template, { a: 'mine', b: '', c: 'keep' }, { a: 'theirs', b: 'new', c: 'keep' })
  expect(r.values).toEqual({ a: 'mine', b: 'new', c: 'keep' })
  expect(r.filled).toEqual(['b'])
  expect(r.offers).toEqual({ a: 'theirs' }) // the same text as typed is no offer
  expect(fillFields(template, {}, { a: 'x' }).open).toEqual(['b', 'c'])
})

test('the question names the fields and what was typed', () => {
  const q = fillQuestion(template, 'p', { a: 'mine' }, 'do it')
  expect(q).toContain('a *: first')
  expect(q).toContain('b *: second (e.g. x)')
  expect(q).toContain('a = "mine"')
  expect(q).toContain('Text: do it')
})

test('a reply outside a fixed list is dropped, unless the field allows another value', () => {
  const t = {
    name: 'tpl',
    fields: [
      { name: 'env', required: true, example: '', description: 'where', options: ['staging', 'production'] },
      { name: 'region', required: false, example: '', description: 'which', options: ['eu'], allowOther: true },
    ],
  } as TemplateInfo
  expect(parseAnswer(t, '{"env":"prod","region":"us"}')).toEqual({ answer: { region: 'us' } })
  expect(parseAnswer(t, '{"env":"production"}')).toEqual({ answer: { env: 'production' } })
  expect(fillQuestion(t, '', {}, 'x')).toContain('env * : where (one of: staging, production)'.replace(' :', ':'))
})
