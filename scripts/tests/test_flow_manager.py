"""Tests of scripts/flow_manager.py. Each class mirrors a TypeScript test file of hooks/infra/flow-manager.
The script runs as a subprocess against a temporary HOME."""
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'flow_manager.py')
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NOW = '2026-01-01T00:00:00.000Z'


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = os.path.realpath(self._tmp.name)
        self.home = self.root + '/h'
        self.plugin = self.root + '/plugin'
        self.active = self.home + '/.claude/zeremai/active'
        self.dir = self.active + '/p1'
        self.env = {**os.environ, 'FLOW_MANAGER_HOME': self.home, 'FLOW_MANAGER_PLUGIN_ROOT': self.plugin, 'FLOW_MANAGER_NOW': NOW}

    # a file on the fake disk
    def put(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(data if isinstance(data, str) else json.dumps(data))

    def get(self, path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)

    def exists(self, path):
        return os.path.exists(path)

    def run_raw(self, subcommand, raw, env=None, cwd=None):
        p = subprocess.run([sys.executable, SCRIPT, subcommand, '--json', raw], capture_output=True, text=True, encoding='utf-8', env=env or self.env, cwd=cwd)
        return p.returncode, p.stdout

    def call(self, subcommand, **args):
        code, out = self.run_raw(subcommand, json.dumps(args))
        self.assertEqual(out.count('\n'), 1, out)  # exactly one line
        result = json.loads(out)
        self.assertEqual(code, 0 if result['status'] == 'ok' else 1)
        return result

    def ok(self, subcommand, **args):
        result = self.call(subcommand, **args)
        self.assertEqual(result['status'], 'ok', result)
        return result

    def err(self, subcommand, text, **args):
        result = self.call(subcommand, **args)
        self.assertEqual(result['status'], 'error', result)
        self.assertIn(text, result['message'])
        return result


def step(**extra):
    return {'id': 's1', 'number': 0, 'name': 'Design', 'status': 'pending', 'stepRef': 'r1', 'stepDefinition': {}, **extra}


def flow_file(dir_, extra=None, steps=None):
    return {
        'type': 'flow-instance', 'id': 'pid', 'name': 'P', 'status': 'running',
        'metadata': {'template': 'T', 'created': 'then', 'lastUpdated': 'then', 'flowPath': dir_},
        'parameters': {}, 'currentState': {'activeStep': {'id': 's1', 'name': 'Design', 'actionSummary': 'x', 'totalSteps': 1, 'totalSubsteps': 0}},
        'steps': [step()] if steps is None else steps, **(extra or {}),
    }


def log_file():
    return {
        'type': 'log-file', 'metadata': {'flow': 'pid'}, 'steps': {},
        'flowWideObservations': {'patternsDetected': [], 'userFeedbackSummary': [], 'efficiencyMetrics': {}, 'recommendationsForFuture': []},
        'executionMetrics': {'totalSteps': 1, 'stepsCompleted': 0, 'currentStep': 's1'},
    }


class FlowBase(Base):
    def setUp(self):
        super().setUp()
        self.flow = self.dir + '/flow.json'
        self.log = self.dir + '/log.json'

    def put_flow(self, extra=None, steps=None):
        self.put(self.flow, flow_file(self.dir, extra, steps))


# ── tools.test.ts ─────────────────────────────────────────────────────────

class ToolsTest(FlowBase):
    def test_every_tool_of_tools_ts_has_a_subcommand(self):
        names = []
        for name in ['tools.ts', 'findings-tools.ts']:
            with open(os.path.join(REPO, 'hooks/infra/flow-manager', name), encoding='utf-8') as f:
                names += re.findall(r"tool\('([a-z_]+)'", f.read())
        self.assertGreaterEqual(len(names), 15)
        for name in names:
            if name == 'bind_flow':
                continue  # the session link lives in the mod's store, not in files
            result = self.call(name.replace('_', '-'))  # no input: a missing-input error, not "Unknown flow tool"
            self.assertNotIn('Unknown flow tool', result.get('message', ''), name)
        self.err('approve-step', 'Missing input for approve_step: flowDir, stepId')

    def test_a_tool_runs_and_answers_as_the_script_did(self):
        self.put_flow()
        self.assertEqual(self.call('update-step-status', flowDir=self.dir, stepId='s1', status='in_progress'), {'status': 'ok', 'files_written': ['flow.json']})

    def test_missing_input_and_a_value_outside_an_enum(self):
        self.put_flow()
        self.assertEqual(self.call('update-step-status', flowDir=self.dir), {'status': 'error', 'message': 'Missing input for update_step_status: stepId, status'})
        self.err('update-step-status', 'Invalid status "nope"', flowDir=self.dir, stepId='s1', status='nope')

    def test_a_rule_that_fails_is_an_error_answer(self):
        self.put_flow()
        self.assertEqual(self.call('update-step-status', flowDir=self.dir, stepId='zzz', status='completed'), {'status': 'error', 'message': 'Step zzz not found'})

    def test_a_path_with_backslashes_works(self):
        self.put_flow()
        self.ok('update-step-status', flowDir=self.dir.replace('/', '\\'), stepId='s1', status='in_progress')

    def test_unknown_tool_bad_json_and_non_object_are_errors(self):
        self.assertEqual(self.call('nope')['status'], 'error')
        code, out = self.run_raw('update-step-status', '{oops')
        self.assertEqual((code, json.loads(out)['status']), (1, 'error'))
        code, out = self.run_raw('update-step-status', '[1]')
        self.assertEqual((code, json.loads(out)['status']), (1, 'error'))

    def test_a_file_is_written_as_json_with_two_spaces_and_a_final_new_line(self):
        self.put_flow()
        self.ok('update-step-status', flowDir=self.dir, stepId='s1', status='in_progress')
        with open(self.flow, encoding='utf-8') as f:
            text = f.read()
        self.assertTrue(text.endswith('}\n'))
        self.assertIn('\n  "type": "flow-instance",', text)
        self.assertEqual(text, json.dumps(json.loads(text), indent=2, ensure_ascii=False) + '\n')

    def test_two_calls_at_once_both_land(self):
        self.put_flow(steps=[step(), step(id='s2')])
        results = []

        def go(step_id):
            results.append(self.call('update-step-status', flowDir=self.dir, stepId=step_id, status='in_progress'))
        threads = [threading.Thread(target=go, args=(s,)) for s in ['s1'] * 6]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertTrue(all(r['status'] == 'ok' for r in results), results)
        self.assertEqual([s['status'] for s in self.get(self.flow)['steps']], ['in_progress', 'pending'])
        self.assertEqual([n for n in os.listdir(self.dir)], ['flow.json'])  # no lock or temp file in the flow folder


# ── step-status.test.ts ───────────────────────────────────────────────────

class StepStatusTest(FlowBase):
    def test_in_progress_sets_status_and_started_at_and_keeps_unknown_fields(self):
        self.put_flow({'custom': 'kept'})
        self.assertEqual(self.ok('update-step-status', flowDir=self.dir, stepId='s1', status='in_progress'), {'status': 'ok', 'files_written': ['flow.json']})
        saved = self.get(self.flow)
        self.assertEqual(saved['steps'][0]['status'], 'in_progress')
        self.assertIn('startedAt', saved['steps'][0])
        self.assertNotEqual(saved['metadata']['lastUpdated'], 'then')
        self.assertEqual(saved['custom'], 'kept')

    def test_started_at_is_not_set_again(self):
        self.put_flow(steps=[step(startedAt='first')])
        self.ok('update-step-status', flowDir=self.dir, stepId='s1', status='in_progress')
        self.assertEqual(self.get(self.flow)['steps'][0]['startedAt'], 'first')

    def test_completed_sets_completed_at_and_counts_finished_steps_in_the_log(self):
        self.put_flow(steps=[step(), step(id='s2', status='completed')])
        self.put(self.log, log_file())
        self.ok('update-step-status', flowDir=self.dir, stepId='s1', status='completed')
        self.assertIn('completedAt', self.get(self.flow)['steps'][0])
        self.assertEqual(self.get(self.log)['executionMetrics']['stepsCompleted'], 2)

    def test_a_step_that_needs_approval_cannot_complete_before_the_user_approved_it(self):
        self.put_flow(steps=[step(approvalRequired=True)])
        self.err('update-step-status', 'requires user approval', flowDir=self.dir, stepId='s1', status='completed')
        self.assertEqual(self.get(self.flow)['steps'][0]['status'], 'pending')

    def test_an_approved_step_completes(self):
        self.put_flow(steps=[step(approvalRequired=True, approved=True)])
        self.ok('update-step-status', flowDir=self.dir, stepId='s1', status='completed')
        self.assertEqual(self.get(self.flow)['steps'][0]['status'], 'completed')

    def test_a_blocked_step_keeps_the_reason_and_the_command_until_it_moves_on(self):
        self.put_flow(steps=[step(status='in_progress')])
        self.err('update-step-status', 'needs a reason', flowDir=self.dir, stepId='s1', status='blocked')
        self.ok('update-step-status', flowDir=self.dir, stepId='s1', status='blocked', reason=' The az login expired. ', command='az login')
        blocked = self.get(self.flow)['steps'][0]
        self.assertEqual(blocked['status'], 'blocked')
        self.assertEqual((blocked['blocked']['reason'], blocked['blocked']['command']), ('The az login expired.', 'az login'))
        self.assertIn('since', blocked['blocked'])
        self.err('update-step-status', 'is blocked', flowDir=self.dir, stepId='s1', status='completed')
        self.ok('update-step-status', flowDir=self.dir, stepId='s1', status='in_progress')
        self.assertNotIn('blocked', self.get(self.flow)['steps'][0])

    def test_a_step_cannot_start_before_an_earlier_step_is_done(self):
        for early in ['pending', 'in_progress', 'blocked', 'awaiting_approval']:
            self.put_flow(steps=[step(status=early), step(id='s2', number=1, status='pending')])
            self.err('update-step-status', 'cannot start', flowDir=self.dir, stepId='s2', status='in_progress')
            self.assertEqual(self.get(self.flow)['steps'][1]['status'], 'pending')

    def test_a_step_starts_after_earlier_steps_are_completed_or_skipped(self):
        self.put_flow(steps=[step(status='completed'), step(id='s2', number=1, status='skipped'), step(id='s3', number=2)])
        self.ok('update-step-status', flowDir=self.dir, stepId='s3', status='in_progress')

    def test_unknown_status_unknown_step_and_missing_flow_are_errors(self):
        self.put_flow()
        self.err('update-step-status', 'Invalid status', flowDir=self.dir, stepId='s1', status='nope')
        self.err('update-step-status', 'Step zzz not found', flowDir=self.dir, stepId='zzz', status='completed')
        self.err('update-step-status', 'flow.json not found', flowDir=self.root + '/none', stepId='s1', status='completed')

    def test_current_state_sets_the_active_step_with_a_substep_when_both_parts_are_given(self):
        self.put_flow()
        self.ok('update-current-state', flowDir=self.dir, stepId='s2', stepName='Build', summary='Building', details='d', totalSubsteps=3, substepNumber=1, substepName='first')
        self.assertEqual(self.get(self.flow)['currentState'], {
            'activeStep': {'id': 's2', 'name': 'Build', 'actionSummary': 'Building', 'totalSubsteps': 3, 'actionDetails': 'd', 'currentSubstep': {'number': 1, 'name': 'first'}}})

    def test_current_state_without_details_and_substep_leaves_them_out(self):
        self.put_flow()
        self.ok('update-current-state', flowDir=self.dir, stepId='s2', stepName='Build', summary='Building', substepNumber=1)
        self.assertEqual(self.get(self.flow)['currentState']['activeStep'], {'id': 's2', 'name': 'Build', 'actionSummary': 'Building', 'totalSubsteps': 0})

    def test_active_substep_sets_the_substep_and_the_summary(self):
        self.put_flow()
        self.ok('update-active-substep', flowDir=self.dir, substepNumber=2, substepName='second', summary='now')
        active = self.get(self.flow)['currentState']['activeStep']
        self.assertEqual(active['currentSubstep'], {'number': 2, 'name': 'second'})
        self.assertEqual(active['actionSummary'], 'now')

    def test_active_substep_with_no_active_step_is_an_error(self):
        self.put_flow({'currentState': {}})
        self.err('update-active-substep', 'no active step', flowDir=self.dir, substepNumber=1, substepName='a')


# ── approval-gate.test.ts (approve part) ──────────────────────────────────

class ApproveStepTest(FlowBase):
    def test_approve_sets_approved_keeps_the_other_fields_and_updates_the_time(self):
        self.put_flow(steps=[step(status='in_progress', approvalRequired=True)])
        self.assertEqual(self.ok('approve-step', flowDir=self.dir, stepId='s1'), {'status': 'ok', 'files_written': ['flow.json']})
        saved = self.get(self.flow)
        self.assertIs(saved['steps'][0]['approved'], True)
        self.assertEqual(saved['steps'][0]['name'], 'Design')
        self.assertNotEqual(saved['metadata']['lastUpdated'], 'then')

    def test_a_step_that_needs_no_approval_and_an_unknown_step_are_refused(self):
        self.put_flow(steps=[step(status='in_progress')])
        self.err('approve-step', 'does not require approval', flowDir=self.dir, stepId='s1')
        self.err('approve-step', 'Step zzz not found', flowDir=self.dir, stepId='zzz')
        self.assertNotIn('approved', self.get(self.flow)['steps'][0])

    def test_after_approval_the_step_completes(self):
        self.put_flow(steps=[step(status='in_progress', approvalRequired=True)])
        self.err('update-step-status', 'requires user approval', flowDir=self.dir, stepId='s1', status='completed')
        self.ok('approve-step', flowDir=self.dir, stepId='s1')
        self.ok('update-step-status', flowDir=self.dir, stepId='s1', status='completed')


# ── log.test.ts ───────────────────────────────────────────────────────────

class LogTest(FlowBase):
    def setUp(self):
        super().setUp()
        self.put(self.log, log_file())

    def entry(self, step_id='s1'):
        return self.get(self.log)['steps'][step_id]

    def test_a_new_log_entry_has_the_lists_a_start_time_and_the_current_step(self):
        self.ok('add-log-entry', flowDir=self.dir, stepId='s2', actions=['a1'], reasoning=['r1'])
        self.assertEqual(self.entry('s2')['actionsTaken'], ['a1'])
        self.assertEqual(self.entry('s2')['agentReasoning'], ['r1'])
        self.assertIn('startedAt', self.entry('s2')['timestamp'])
        self.assertEqual(self.get(self.log)['executionMetrics']['currentStep'], 's2')

    def test_a_new_entry_leaves_out_empty_actions_and_keeps_an_empty_list_of_another_kind(self):
        self.ok('add-log-entry', flowDir=self.dir, stepId='s1', actions=[], problems=[])
        self.assertNotIn('actionsTaken', self.entry())
        self.assertEqual(self.entry()['problemsEncountered'], [])

    def test_an_entry_that_exists_grows_and_a_text_timestamp_becomes_start_and_update_times(self):
        data = log_file()
        data['steps'] = {'s1': {'timestamp': 'old', 'actionsTaken': ['a1']}}
        self.put(self.log, data)
        self.ok('add-log-entry', flowDir=self.dir, stepId='s1', actions=['a2'], decisions=['d'])
        self.assertEqual(self.entry()['actionsTaken'], ['a1', 'a2'])
        self.assertEqual(self.entry()['decisionsMade'], ['d'])
        self.assertEqual(self.entry()['timestamp']['startedAt'], 'old')
        self.assertIn('updatedAt', self.entry()['timestamp'])

    def test_no_log_file_is_an_error(self):
        os.remove(self.log)
        self.err('add-log-entry', 'log.json not found', flowDir=self.dir, stepId='s1')

    def test_log_a_user_interaction_in_a_new_entry(self):
        self.ok('log-interaction', flowDir=self.dir, stepId='s1', request='r', reason='why', response='ok')
        interaction = self.entry()['userInteractions'][0]
        self.assertEqual({k: interaction[k] for k in ['request', 'reason', 'agentResponse']}, {'request': 'r', 'reason': 'why', 'agentResponse': 'ok'})
        self.assertNotIn('forImprovementStep', interaction)

    def test_log_a_user_interaction_in_an_entry_that_exists_marked_for_improvement(self):
        data = log_file()
        data['steps'] = {'s1': {'timestamp': {'startedAt': 'a'}, 'userInteractions': [{'request': 'first'}]}}
        self.put(self.log, data)
        self.ok('log-interaction', flowDir=self.dir, stepId='s1', request='r', reason='why', response='ok', forImprovement=True, potentialImprovement='faster')
        items = self.entry()['userInteractions']
        self.assertEqual(len(items), 2)
        self.assertIs(items[1]['forImprovementStep'], True)
        self.assertEqual(items[1]['potentialImprovement'], 'faster')
        self.assertIn('updatedAt', self.entry()['timestamp'])

    def test_observations_lists_grow_and_metrics_merge(self):
        self.ok('update-log-observations', flowDir=self.dir, patterns=['p1'], feedback=['f1'], metrics={'a': 1}, recommendations=['r1'])
        self.ok('update-log-observations', flowDir=self.dir, patterns=['p2'], metrics={'b': 2})
        self.assertEqual(self.get(self.log)['flowWideObservations'], {
            'patternsDetected': ['p1', 'p2'], 'userFeedbackSummary': ['f1'], 'efficiencyMetrics': {'a': 1, 'b': 2}, 'recommendationsForFuture': ['r1']})


# ── memory.test.ts ────────────────────────────────────────────────────────

XREF = {'type': 'memory-cross-references', 'keyDecisions': [], 'filesModified': [], 'filesCreated': [], 'custom': {}}


class MemoryTest(FlowBase):
    def setup_usage(self, usage=None):
        self.put_flow(steps=[step(stepDefinition={'memoryFileUsage': usage} if usage else {})])
        self.put(self.dir + '/memory/_cross-references.json', XREF)

    def test_a_new_topic_gives_the_entry_the_topic_file_and_the_cross_references(self):
        self.setup_usage()
        result = self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='context', info={'a': 1}, decisions=['d1'], files=['f1'])
        self.assertEqual(result['files_written'], ['memory/context.json', 'memory/_cross-references.json'])
        topic = self.get(self.dir + '/memory/context.json')
        self.assertEqual(topic['type'], 'memory-topic-file')
        entry = topic['entries']['s1']
        self.assertEqual((entry['stepName'], entry['informationProduced'], entry['decisionsMade'], entry['filesModifiedCreated']), ('Design', {'a': 1}, ['d1'], ['f1']))
        xref = self.get(self.dir + '/memory/_cross-references.json')
        self.assertEqual((xref['keyDecisions'], xref['filesModified']), (['d1'], ['f1']))

    def test_a_second_entry_for_the_step_merges(self):
        self.setup_usage()
        self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='context', info={'a': 1, 'b': 1}, decisions=['d1'])
        self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='context', info={'b': 2}, decisions=['d2'], files=['f2'])
        entry = self.get(self.dir + '/memory/context.json')['entries']['s1']
        self.assertEqual((entry['informationProduced'], entry['decisionsMade'], entry['filesModifiedCreated']), ({'a': 1, 'b': 2}, ['d1', 'd2'], ['f2']))
        self.assertEqual(self.get(self.dir + '/memory/_cross-references.json')['keyDecisions'], ['d1', 'd2'])

    def test_a_topic_the_step_may_not_write_is_an_error(self):
        self.setup_usage({'writeTo': ['context.json']})
        self.err('add-memory-entry', 'is not allowed to write to topic "secret.json"', flowDir=self.dir, stepId='s1', topic='secret')
        self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='context')

    def test_an_empty_list_of_topics_means_no_limit(self):
        self.setup_usage({'writeTo': [], 'readFrom': []})
        self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='anything')
        self.assertIsNotNone(self.ok('read-memory-topic', flowDir=self.dir, stepId='s1', topic='anything')['data'])

    def test_no_memory_folder_is_an_error(self):
        self.put_flow()
        self.err('add-memory-entry', 'memory/ directory not found', flowDir=self.dir, stepId='s1', topic='x')

    def test_read_gives_the_topic_or_null(self):
        self.setup_usage()
        self.assertEqual(self.ok('read-memory-topic', flowDir=self.dir, stepId='s1', topic='context'), {'status': 'ok', 'topic': 'context', 'data': None})
        self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='context', info={'a': 1})
        self.assertEqual(self.ok('read-memory-topic', flowDir=self.dir, stepId='s1', topic='context')['data']['entries']['s1']['informationProduced'], {'a': 1})

    def test_read_a_step_may_read_the_cross_references_and_only_the_topics_it_lists(self):
        self.setup_usage({'readFrom': ['context.json']})
        self.assertEqual(self.ok('read-memory-topic', flowDir=self.dir, stepId='s1', topic='_cross-references')['data'], XREF)
        self.err('read-memory-topic', 'is not allowed to read from', flowDir=self.dir, stepId='s1', topic='secret')

    def test_a_repeated_call_adds_no_decision_or_file_twice(self):
        self.setup_usage()
        for _ in range(2):
            self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='context', decisions=['d1'], files=['f1'])
        entry = self.get(self.dir + '/memory/context.json')['entries']['s1']
        self.assertEqual((entry['decisionsMade'], entry['filesModifiedCreated']), (['d1'], ['f1']))
        xref = self.get(self.dir + '/memory/_cross-references.json')
        self.assertEqual((xref['keyDecisions'], xref['filesModified']), (['d1'], ['f1']))


# ── create-flow.test.ts ───────────────────────────────────────────────────

class StepBriefTest(FlowBase):
    def setup_step(self, usage):
        self.put_flow(extra={'parameters': {'ticket': 'PAY-123'}}, steps=[step(
            number=3, stepDefinition={'guidance': {'specificActions': ['plan it']}, 'memoryFileUsage': usage})])
        self.put(self.dir + '/memory/_cross-references.json', XREF)

    def test_the_brief_holds_the_step_the_parameters_and_the_content_of_the_declared_topics(self):
        self.setup_step({'readFrom': ['context.json'], 'writeTo': ['context.json', 'secret.json']})
        self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='context', info={'ticket': 'PAY-123'})
        self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='secret', info={'hidden': 'yes'})
        text = self.ok('get-step-brief', flowDir=self.dir, stepId='s1')['text']
        for part in ['# Step 3: Design', 'Step ID: s1', '"ticket": "PAY-123"', 'plan it', '### context', '"informationProduced"']:
            self.assertIn(part, text)
        self.assertNotIn('hidden', text)  # not in readFrom
        self.assertNotIn('Earlier summary', text)
        self.assertNotIn('User corrections', text)

    def test_a_step_with_no_declared_topic_gets_no_memory(self):
        self.setup_step({'readFrom': []})
        self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='context', info={'a': 1})
        self.assertIn('(this step reads no memory topic)', self.ok('get-step-brief', flowDir=self.dir, stepId='s1')['text'])

    def test_a_declared_topic_with_no_file_says_so(self):
        self.setup_step({'readFrom': ['context.json']})
        self.assertIn('(no entries yet)', self.ok('get-step-brief', flowDir=self.dir, stepId='s1')['text'])

    def test_a_rerun_gets_its_own_summary_and_the_corrections(self):
        self.setup_step({'readFrom': [], 'writeTo': ['plan.json']})  # writeTo does not list the reserved topic
        self.ok('add-memory-entry', flowDir=self.dir, stepId='s1', topic='rerun-summary', info={'summary': 'Plan written.'})
        text = self.ok('get-step-brief', flowDir=self.dir, stepId='s1', corrections='Use PAY-124.')['text']
        self.assertIn('## Earlier summary\nPlan written.', text)
        self.assertIn('## User corrections\nUse PAY-124.', text)

    def test_the_summary_of_another_step_is_not_in_the_brief(self):
        self.put_flow(steps=[step(stepDefinition={'guidance': {}}), step(id='s2', number=1, stepDefinition={'guidance': {}})])
        self.put(self.dir + '/memory/_cross-references.json', XREF)
        self.ok('add-memory-entry', flowDir=self.dir, stepId='s2', topic='rerun-summary', info={'summary': 'Other step.'})
        self.assertNotIn('Other step.', self.ok('get-step-brief', flowDir=self.dir, stepId='s1', corrections='x')['text'])

    def test_an_empty_definition_is_an_error(self):
        self.put_flow()
        self.err('get-step-brief', 'sub-flow step', flowDir=self.dir, stepId='s1')

    def test_an_unknown_step_is_an_error(self):
        self.put_flow()
        self.err('get-step-brief', 'Step nope not found', flowDir=self.dir, stepId='nope')

    def test_the_summary_topic_is_not_readable_by_a_step_that_lists_other_topics(self):
        self.setup_step({'readFrom': ['context.json']})
        self.err('read-memory-topic', 'is not allowed to read from', flowDir=self.dir, stepId='s1', topic='rerun-summary')


class CreateFlowTest(Base):
    TEMPLATE = {
        'name': 'Fix a bug', 'id': 'tid', 'category': 'dev',
        'steps': [
            {'name': 'Design', 'stepRef': 'ref1', 'stepRefName': 'design', 'approvalRequired': True},
            {'name': 'Build', 'stepRef': 'ref2', 'loopBackTo': 'x', 'maxIterations': 3},
            {'name': 'Orchestrator', 'stepRef': ''},
        ],
    }

    def setUp(self):
        super().setUp()
        self.t = self.root + '/t/tpl'
        self.new = self.active + '/new1'
        self.put_files()

    def put_files(self):
        self.put(self.t + '/template.json', self.TEMPLATE)
        self.put(self.t + '/design/design.json', {'type': 'step', 'id': 'ref1', 'output': {'description': 'the design'}, 'substeps': [{}, {}], 'memoryFileUsage': {'writeTo': ['context.json']}, 'ignored': 'x'})
        self.put(self.t + '/build/build.json', {'type': 'step', 'id': 'ref2', 'guidance': {'g': 1}, 'workflow': 'w'})
        self.put(self.plugin + '/framework-steps/improve/improve.json', {'type': 'framework-step', 'id': 'fw1', 'metadata': {'title': 'Improve'}, 'approvalRequired': False, 'output': {'description': 'findings'}})
        self.put(self.plugin + '/framework-steps/notes/notes.json', {'type': 'other'})

    def create(self, **extra):
        return self.call('create-flow', flowDir=self.new, templatePath=self.t + '/template.json', **extra)

    def test_creates_the_three_files(self):
        self.assertEqual(self.create(params={'id': '7'}, projectPath='/proj'), {'status': 'ok', 'files_written': ['flow.json', 'memory/_cross-references.json', 'log.json']})
        flow = self.get(self.new + '/flow.json')
        self.assertEqual((flow['type'], flow['name'], flow['status'], flow['parameters']), ('flow-instance', 'Fix a bug', 'running', {'id': '7'}))
        meta = flow['metadata']
        self.assertEqual((meta['template'], meta['templateId'], meta['templateCategory'], meta['projectPaths'], meta['flowPath']), ('Fix a bug', 'tid', 'dev', ['/proj'], self.new))
        self.assertEqual(self.get(self.new + '/memory/_cross-references.json')['type'], 'memory-cross-references')
        self.assertEqual(self.get(self.new + '/log.json')['executionMetrics'], {'totalSteps': 4, 'stepsCompleted': 0, 'currentStep': flow['steps'][0]['id']})

    def test_each_template_step_gets_its_definition_from_the_step_file_and_unknown_fields_stay_out(self):
        self.create()
        design, build, orchestrator = self.get(self.new + '/flow.json')['steps'][:3]
        for key, value in {'number': 0, 'name': 'Design', 'status': 'pending', 'stepRef': 'ref1', 'stepRefName': 'design', 'approvalRequired': True}.items():
            self.assertEqual(design[key], value)
        self.assertEqual(design['stepDefinition'], {'output': {'description': 'the design'}, 'substeps': [{}, {}], 'memoryFileUsage': {'writeTo': ['context.json']}})
        self.assertEqual((build['loopBackTo'], build['maxIterations']), ('x', 3))
        self.assertEqual(build['stepDefinition'], {'guidance': {'g': 1}, 'workflow': 'w'})
        self.assertEqual(orchestrator['stepDefinition'], {})

    def test_framework_steps_go_at_the_end_and_only_the_ones_of_the_right_type(self):
        self.create()
        steps = self.get(self.new + '/flow.json')['steps']
        self.assertEqual(len(steps), 4)
        for key, value in {'number': 3, 'name': 'Improve', 'stepRef': 'fw1', 'stepRefName': 'improve', 'approvalRequired': False}.items():
            self.assertEqual(steps[3][key], value)

    def test_the_active_step_is_the_first_step_and_the_project_path_defaults_to_the_session_folder(self):
        code, out = self.run_raw('create-flow', json.dumps({'flowDir': self.new, 'templatePath': self.t + '/template.json'}), cwd=self.root)
        self.assertEqual(code, 0, out)
        flow = self.get(self.new + '/flow.json')
        active = flow['currentState']['activeStep']
        self.assertEqual((active['id'], active['name'], active['totalSubsteps'], active['actionSummary']), (flow['steps'][0]['id'], 'Design', 2, 'Initializing flow'))
        self.assertEqual(flow['metadata']['projectPaths'], [self.root])

    def test_a_name_given_wins_over_the_template_name(self):
        self.create(name='My run')
        self.assertEqual(self.get(self.new + '/flow.json')['name'], 'My run')

    def test_a_sub_flow_reads_the_parent_from_its_file_when_no_id_and_name_are_given(self):
        parent = self.root + '/parent'
        self.put(parent + '/flow.json', {'id': 'pid', 'name': 'Parent'})
        self.create(parentFlowPath=parent, returnToStep='ps2')
        self.assertEqual(self.get(self.new + '/flow.json')['subFlowState'], {'parentFlow': {'id': 'pid', 'name': 'Parent', 'flowPath': parent, 'returnToStep': 'ps2'}, 'childFlows': []})
        self.assertEqual(self.get(self.new + '/log.json')['metadata']['parentFlowPath'], parent)

    def test_errors_flow_exists_template_missing_step_id_not_found(self):
        self.put(self.new + '/flow.json', '{}')
        self.err('create-flow', 'Flow already exists', flowDir=self.new, templatePath=self.t + '/template.json')
        self.err('create-flow', 'Template not found', flowDir=self.active + '/other', templatePath=self.root + '/nope.json')
        os.remove(self.t + '/build/build.json')
        self.err('create-flow', 'Step definition UUID not found in template directory: ref2', flowDir=self.active + '/other', templatePath=self.t + '/template.json')


# ── flow-status.test.ts ───────────────────────────────────────────────────

class FlowStatusTest(FlowBase):
    def test_a_status_that_keeps_the_flow_in_active_moves_nothing(self):
        self.put_flow()
        self.assertEqual(self.ok('update-flow-status', flowDir=self.dir, status='paused'), {'status': 'ok', 'files_written': ['flow.json']})
        self.assertEqual(self.get(self.flow)['status'], 'paused')
        self.assertTrue(self.exists(self.flow))

    def test_completed_moves_the_folder_to_completed_and_flow_path_follows(self):
        self.put_flow()
        self.put(self.log, {})
        result = self.ok('update-flow-status', flowDir=self.dir, status='completed')
        target = self.home + '/.claude/zeremai/completed/p1'
        self.assertEqual(result['relocated_to'], target)
        moved = self.get(target + '/flow.json')
        self.assertEqual(moved['metadata']['flowPath'], target)
        self.assertEqual(moved['metadata']['completed'], moved['metadata']['lastUpdated'])
        self.assertTrue(self.exists(target + '/log.json'))
        self.assertFalse(self.exists(self.flow))

    def test_failed_goes_to_failed_and_back_to_running_goes_to_active(self):
        self.put_flow()
        self.ok('update-flow-status', flowDir=self.dir, status='failed')
        failed = self.home + '/.claude/zeremai/failed/p1'
        self.assertTrue(self.exists(failed + '/flow.json'))
        self.ok('update-flow-status', flowDir=failed, status='running')
        self.assertTrue(self.exists(self.flow))

    def test_a_target_folder_that_exists_is_an_error(self):
        self.put_flow()
        self.put(self.home + '/.claude/zeremai/completed/p1/flow.json', '{}')
        self.err('update-flow-status', 'target directory already exists', flowDir=self.dir, status='completed')

    def test_a_move_that_fails_is_an_error_that_says_why(self):
        self.put_flow()
        target_parent = self.home + '/.claude/zeremai/completed'
        os.makedirs(self.home + '/.claude/zeremai', exist_ok=True)
        self.put(target_parent, 'a file where the folder should be')  # the move cannot make the folder
        self.err('update-flow-status', 'Cannot relocate:', flowDir=self.dir, status='completed')
        self.assertEqual(self.get(self.flow)['status'], 'completed')  # the flow file keeps the new status

    def test_an_unknown_status_is_an_error(self):
        self.put_flow()
        self.err('update-flow-status', 'Invalid status', flowDir=self.dir, status='done')

    # sub-flows
    def family(self, with_parent=True):
        self.parent = self.active + '/parent'
        child = {'id': 'cid', 'name': 'Child', 'status': 'running', 'spawnedAtStep': 'ps1', 'syncPoint': 'ps2', 'flowPath': self.dir}
        self.put(self.flow, flow_file(self.dir, {'id': 'cid', 'subFlowState': {'parentFlow': {'id': 'pid', 'name': 'Parent', 'flowPath': self.parent, 'returnToStep': 'ps2'}, 'childFlows': []}}))
        if with_parent:
            self.put(self.parent + '/flow.json', flow_file(self.parent, {'id': 'pid', 'subFlowState': {'parentFlow': None, 'childFlows': [child]}}, [{'id': 'ps1', 'name': 'Spawn step', 'status': 'in_progress'}]))
            self.put(self.parent + '/memory/_cross-references.json', {})

    def test_a_sub_flow_cannot_complete_without_a_summary(self):
        self.family()
        self.err('update-flow-status', 'must provide a summary', flowDir=self.dir, status='completed')
        self.assertEqual(self.get(self.flow)['status'], 'running')

    def test_a_finished_sub_flow_tells_its_parent(self):
        self.family()
        self.ok('update-flow-status', flowDir=self.dir, status='completed', summary='Built it')
        self.assertEqual(self.get(self.parent + '/flow.json')['subFlowState']['childFlows'][0]['status'], 'completed')
        entry = self.get(self.parent + '/memory/sub-flows.json')['entries']['ps1']
        self.assertEqual((entry['stepName'], entry['informationProduced']), ('Spawn step', {'childSummary_cid': 'Built it'}))

    def test_a_parent_that_cannot_be_told_does_not_stop_the_child_from_completing(self):
        self.family(with_parent=False)
        self.assertEqual(self.ok('update-flow-status', flowDir=self.dir, status='completed', summary='Built it')['status'], 'ok')

    def test_register_a_child_first_child_then_the_same_child_again_replaces_it(self):
        self.put_flow()
        base = dict(flowDir=self.dir, childId='c1', childName='C', childStatus='running', spawnedAtStep='s1', syncPoint='s2', childFlowPath='/c')
        self.ok('register-child-flow', **base)
        self.ok('register-child-flow', **{**base, 'childStatus': 'paused'})
        self.ok('register-child-flow', **{**base, 'childId': 'c2'})
        state = self.get(self.flow)['subFlowState']
        self.assertIsNone(state['parentFlow'])
        self.assertEqual([[c['id'], c['status']] for c in state['childFlows']], [['c1', 'paused'], ['c2', 'running']])

    def test_update_a_child_status_unknown_child_or_no_children_is_an_error(self):
        child = {'id': 'cid', 'name': 'Child', 'status': 'running', 'spawnedAtStep': 'ps1', 'syncPoint': 'ps2', 'flowPath': self.dir}
        self.put_flow({'subFlowState': {'parentFlow': None, 'childFlows': [child]}})
        self.ok('update-child-status', flowDir=self.dir, childId='cid', childStatus='failed')
        self.assertEqual(self.get(self.flow)['subFlowState']['childFlows'][0]['status'], 'failed')
        self.err('update-child-status', 'not found', flowDir=self.dir, childId='zzz', childStatus='failed')
        self.put_flow()
        self.err('update-child-status', 'No subFlowState', flowDir=self.dir, childId='cid', childStatus='failed')


# ── findings.test.ts ──────────────────────────────────────────────────────

class FindingsTest(FlowBase):
    FINDING = {'category': 'c', 'title': 't', 'what': 'w', 'why': 'y', 'impact': 'i'}

    def setUp(self):
        super().setUp()
        self.store = self.home + '/.claude/zeremai/improvement-findings'

    def put_flow_meta(self, **meta):
        data = flow_file(self.dir, steps=[])
        data['metadata'] = {**data['metadata'], **meta}
        self.put(self.flow, data)

    def test_a_finding_is_saved_under_the_template_id_with_status_open(self):
        self.put_flow_meta(templateId='tid')
        result = self.ok('write-finding', flowDir=self.dir, scope=['a.ts'], **self.FINDING)
        self.assertEqual(result['files_written'], [self.store + '/tid/pid.json'])
        data = self.get(self.store + '/tid/pid.json')
        self.assertEqual((data['type'], data['templateId'], data['flowId'], data['flowName']), ('improvement-findings-file', 'tid', 'pid', 'P'))
        f = data['findings'][0]
        self.assertEqual({k: f[k] for k in ['category', 'title', 'scope', 'status', 'flowId']}, {'category': 'c', 'title': 't', 'scope': ['a.ts'], 'status': 'open', 'flowId': 'pid'})

    def test_without_a_template_id_the_folder_is_the_template_name_and_a_second_finding_is_added(self):
        self.put_flow_meta()
        self.ok('write-finding', flowDir=self.dir, **self.FINDING)
        self.ok('write-finding', flowDir=self.dir, **{**self.FINDING, 'title': 't2'})
        self.assertEqual([f['title'] for f in self.get(self.store + '/T/pid.json')['findings']], ['t', 't2'])

    def put_store(self):
        self.put(self.store + '/t1/p1.json', {'findings': [{'id': 'f1', 'status': 'open'}, {'id': 'f2', 'status': 'applied'}]})
        self.put(self.store + '/t2/p2.json', {'findings': [{'id': 'f3', 'status': 'open'}]})

    def test_list_every_finding_one_status_one_template(self):
        self.put_store()
        ids = lambda **a: [f['id'] for f in self.ok('list-findings', **a)['findings']]
        self.assertEqual(ids(), ['f1', 'f2', 'f3'])
        self.assertEqual(ids(status='open'), ['f1', 'f3'])
        self.assertEqual(ids(templateId='t2'), ['f3'])

    def test_list_no_store_is_an_empty_list(self):
        self.assertEqual(self.call('list-findings'), {'status': 'ok', 'findings': []})

    def test_update_the_status_and_the_resolution_are_recorded(self):
        self.put_store()
        self.ok('update-finding-status', flowId='p1', findingId='f1', status='applied', notes='done', filesModified=['x'])
        f1 = self.get(self.store + '/t1/p1.json')['findings'][0]
        self.assertEqual(f1['status'], 'applied')
        self.assertEqual((f1['resolution']['notes'], f1['resolution']['filesModified']), ('done', ['x']))

    def test_update_no_file_for_the_flow_or_no_such_finding_is_an_error(self):
        self.put_store()
        self.err('update-finding-status', 'No findings file for flow none', flowId='none', findingId='f1', status='applied')
        self.err('update-finding-status', 'Finding zzz not found', flowId='p1', findingId='zzz', status='applied')


class VerifiersTest(FlowBase):
    def verify(self, *scripts, **definition):
        """A step with one verifier for each (source, extra) of scripts. Returns the answer of run-verifiers."""
        entries = []
        for i, (source, extra) in enumerate(scripts):
            path = '%s/v%d.py' % (self.root, i)
            self.put(path, source)
            entries.append({'script': path, **extra})
        self.put_flow(steps=[step(stepDefinition={'verifiers': entries, **definition})])
        return self.ok('run-verifiers', flowDir=self.dir, stepId='s1')

    def answer(self, status, checks):
        return 'print(%r)' % json.dumps({'status': status, 'checks': checks})

    def test_a_step_with_no_verifiers_passes_with_no_checks(self):
        self.put_flow()
        self.assertEqual(self.ok('run-verifiers', flowDir=self.dir, stepId='s1'), {'status': 'ok', 'result': 'pass', 'checks': []})

    def test_a_passing_verifier_passes(self):
        r = self.verify((self.answer('pass', [{'name': 'has plan', 'passed': True}]), {}))
        self.assertEqual((r['result'], r['checks']), ('pass', [{'name': 'has plan', 'passed': True, 'message': ''}]))

    def test_one_failed_check_fails_the_step_and_keeps_its_message_and_the_other_checks(self):
        r = self.verify((self.answer('fail', [{'name': 'a', 'passed': True}, {'name': 'b', 'passed': False, 'message': 'add a rollback section'}]), {}),
                        (self.answer('pass', [{'name': 'c', 'passed': True}]), {}))
        self.assertEqual(r['result'], 'fail')
        self.assertEqual([(c['name'], c['passed']) for c in r['checks']], [('a', True), ('b', False), ('c', True)])
        self.assertEqual(r['checks'][1]['message'], 'add a rollback section')

    def test_a_crash_is_a_failed_check_with_the_last_line_of_the_error(self):
        r = self.verify(('raise ValueError("no design file")', {}))
        self.assertEqual(r['result'], 'fail')
        self.assertEqual(r['checks'][0]['name'], 'v0.py')
        self.assertIn('verifier crashed: ValueError: no design file', r['checks'][0]['message'])

    def test_a_script_that_runs_too_long_is_a_failed_check(self):
        r = self.verify(('import time\ntime.sleep(20)', {'timeoutSec': 1}))
        self.assertEqual((r['result'], r['checks'][0]['message']), ('fail', 'verifier timed out after 1s'))

    def test_the_time_limit_has_a_ceiling(self):
        r = self.verify(('import time\ntime.sleep(30)', {'timeoutSec': 600}))
        self.assertEqual(r['checks'][0]['message'], 'verifier timed out after 8s')

    def test_an_answer_that_is_not_the_shape_is_a_failed_check(self):
        for source in ['print("fine")', '', 'print({"status": "pass"})',
                       self.answer('pass', [{'name': 'a', 'passed': False}]),  # the status disagrees with the checks
                       self.answer('fail', []),
                       self.answer('pass', [{'name': 'a'}])]:
            r = self.verify((source, {}))
            self.assertEqual((r['result'], r['checks'][0]['message']), ('fail', 'verifier answer is not valid'), source)

    def test_a_missing_file_is_a_failed_check(self):
        self.put_flow(steps=[step(stepDefinition={'verifiers': [{'script': self.root + '/none.py'}]})])
        r = self.ok('run-verifiers', flowDir=self.dir, stepId='s1')
        self.assertEqual((r['result'], r['checks'][0]['message']), ('fail', 'verifier file not found'))

    def test_a_flow_that_starts_from_a_template_keeps_the_full_path_of_the_verifier_and_max_fixes(self):
        os.makedirs(self.plugin + '/framework-steps')
        t = self.root + '/t/tpl'
        self.put(t + '/template.json', {'name': 'T', 'id': 'tid', 'steps': [{'name': 'Design', 'stepRef': 'ref1'}]})
        self.put(t + '/design/design.json', {'type': 'step', 'id': 'ref1', 'guidance': {}, 'maxFixes': 3, 'verifiers': [{'script': 'check.py'}]})
        self.ok('create-flow', flowDir=self.active + '/new1', templatePath=t + '/template.json')
        definition = self.get(self.active + '/new1/flow.json')['steps'][0]['stepDefinition']
        self.assertEqual((definition['verifiers'], definition['maxFixes']), ([{'script': t + '/design/check.py'}], 3))

    def test_a_verifier_outside_its_step_folder_stops_the_flow_from_starting(self):
        os.makedirs(self.plugin + '/framework-steps')
        t = self.root + '/t/tpl'
        self.put(t + '/template.json', {'name': 'T', 'id': 'tid', 'steps': [{'name': 'Design', 'stepRef': 'ref1'}]})
        for script in ['../x.py', '/etc/x.py', '']:
            self.put(t + '/design/design.json', {'type': 'step', 'id': 'ref1', 'guidance': {}, 'verifiers': [{'script': script}]})
            self.err('create-flow', 'inside its step folder', flowDir=self.active + '/new1', templatePath=t + '/template.json')


if __name__ == '__main__':
    unittest.main()
