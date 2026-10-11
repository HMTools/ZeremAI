import { test, expect } from 'claude-code/testing'
import { noteRefresh, st } from './pane-state'

test('a refresh line with "failed" is kept as the error of that source, and a good line clears it', () => {
  st.sourceErrors = {}
  noteRefresh(['official: clone failed (could not reach the address)', 'team: updated'])
  expect(st.sourceErrors).toEqual({ official: 'clone failed (could not reach the address)' })
  noteRefresh(['official: updated'])
  expect(st.sourceErrors).toEqual({})
  noteRefresh(['no colon here'])
  expect(st.sourceErrors).toEqual({})
})
