"""Tests of scripts/template_to_page.py. The script runs as a subprocess against a temporary HOME."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'template_to_page.py')
PID, CID, S1, S2, S3, C1, XID = ['22222222-2222-4222-8222-22222222222%d' % i for i in range(1, 8)]


def step_file(id_, name, **extra):
    d = {'type': 'step', 'id': id_, 'name': name, 'metadata': {'title': name, 'purposeAndUsage': 'Purpose of ' + name}}
    d.update(extra)
    return d


def template(id_, name, steps, params=None, **extra):
    t = {'type': 'template', 'id': id_, 'name': name, 'category': 'development',
         'metadata': {'title': name.title(), 'purposeAndUsage': 'Use ' + name},
         'parameters': params or {'required': [], 'optional': [], 'definitions': {}}, 'steps': steps}
    t.update(extra)
    return t


PARAMS = {'required': ['prUrl'], 'optional': ['focus'], 'definitions': {'prUrl': {'description': 'Link', 'type': 'text', 'example': 'https://x/1'}, 'focus': {'description': 'Area', 'type': 'text', 'example': 'auth'}}}


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = os.path.realpath(self._tmp.name)
        self.home = self.root + '/h'
        self.installed = self.home + '/.claude/zeremai/templates/flows/development'
        self.work = self.root + '/work'
        os.makedirs(self.work)

    def write(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            json.dump(data, f)
        return path

    def install(self, t, *steps):
        for s in steps:
            self.write('%s/%s/%s/%s.json' % (self.installed, t['name'], s['name'], s['name']), s)
        return self.write('%s/%s/%s.json' % (self.installed, t['name'], t['name']), t)

    def parent(self, steps, files=(), name='payments', **extra):
        for s in files:
            self.write('%s/%s/%s/%s.json' % (self.work, name, s['name'], s['name']), s)
        return self.write('%s/%s/%s.json' % (self.work, name, name), template(PID, name, steps, PARAMS, **extra))

    def run_script(self, *args):
        env = dict(os.environ, FLOW_MANAGER_HOME=self.home)
        r = subprocess.run([sys.executable, SCRIPT] + list(args), capture_output=True, text=True, env=env, cwd=self.root)
        return r.returncode, json.loads(r.stdout.strip().splitlines()[-1])

    def convert(self, path, out='out.json'):
        code, res = self.run_script(path, '-o', self.root + '/' + out)
        self.assertEqual(code, 0, res)
        with open(self.root + '/' + out) as f:
            return json.load(f), res


class Full(Base):
    def make(self):
        self.install(template(CID, 'review-file', [{'number': 1, 'name': 'Read the diff', 'stepRef': C1}], {'required': ['filePath'], 'optional': [], 'definitions': {'filePath': {'description': 'File', 'type': 'text', 'example': 'a.ts'}}}),
                     step_file(C1, 'Read the diff'))
        files = [
            step_file(S1, 'collect', guidance={'specificActions': ['Read {{prUrl}}', 'Save it']}, output={'description': 'A list', 'artifacts': ['changed.md'], 'memoryUpdates': ['changedFiles']}),
            step_file(S2, 'triage', substeps=[{'number': 1, 'actions': ['Merge', 'Rank']}, {'number': 2, 'actions': ['Show']}]),
            step_file(S3, 'report'),
        ]
        steps = [
            {'number': 1, 'name': 'Collect changes', 'stepRef': S1},
            {'number': 2, 'name': 'Review changed files', 'subFlowTrigger': {'template': CID, 'templateName': 'review-file', 'forEach': 'each file', 'parameters': {'filePath': '{{item}}', 'focus': '{{focus}}'}}},
            {'number': 3, 'name': 'Triage findings', 'stepRef': S2, 'approvalRequired': True, 'loopBackTo': 'review CHANGED files', 'maxIterations': 2, 'loopCondition': 'you ask'},
            {'number': 4, 'name': 'Write report', 'stepRef': S3, 'description': 'Write it.'},
        ]
        return self.parent(steps, files)

    def test_every_field(self):
        page, res = self.convert(self.make())
        self.assertEqual((page['mode'], page['title'], page['category'], page['name'], page['purpose'], page['findings']), ('view', 'Payments', 'development', 'payments', 'Use payments', None))
        self.assertEqual([(p['name'], p['required']) for p in page['params']], [('prUrl', True), ('focus', False)])
        self.assertEqual(page['params'][0], {'name': 'prUrl', 'required': True, 'type': 'text', 'description': 'Link', 'example': 'https://x/1'})
        s = page['steps']
        self.assertEqual([x['kind'] for x in s], ['new', 'sub', 'new', 'new'])
        self.assertEqual([x['approval'] for x in s], [False, False, True, False])
        self.assertEqual(s[0]['actions'], ['Read {{prUrl}}', 'Save it'])
        self.assertEqual(s[0]['output'], ['A list', 'changed.md', 'Memory: changedFiles'])
        self.assertEqual(s[0]['summary'], 'Purpose of collect')
        self.assertEqual(s[2]['actions'], ['Merge', 'Rank', 'Show'])
        self.assertEqual(s[3]['summary'], 'Write it.')
        self.assertEqual(s[3]['actions'], [])
        self.assertEqual(s[1]['summary'], 'Review changed files')
        self.assertEqual(s[2]['loop'], {'to': 1, 'max': 2, 'when': 'you ask'})
        self.assertNotIn('loop', s[0])
        self.assertEqual((s[1]['child'], s[1]['forEach']), ('review-file', 'each file'))
        self.assertEqual(s[1]['uses'], ['focus'])
        self.assertEqual(list(page['children']), ['review-file'])
        self.assertEqual(page['children']['review-file']['steps'][0]['name'], 'Read the diff')
        self.assertEqual(page['children']['review-file']['params'][0]['name'], 'filePath')
        self.assertEqual(res, {'status': 'ok', 'path': self.root + '/out.json', 'steps': 4, 'approvals': 1, 'loops': 1, 'children': 1})

    def test_uses_found_in_the_step_file(self):
        page, _ = self.convert(self.make())
        self.assertEqual(page['steps'][0]['uses'], ['prUrl'])

    def test_phases_computed_from_approvals(self):
        page, _ = self.convert(self.make())
        self.assertEqual([x['phase'] for x in page['steps']], ['Steps 1–3'] * 3 + ['Step 4'])

    def test_given_phases_fill_forward(self):
        steps = [{'name': 'a', 'phase': 'Understand'}, {'name': 'b'}, {'name': 'c', 'phase': 'Review'}, {'name': 'd'}]
        page, _ = self.convert(self.parent(steps))
        self.assertEqual([x['phase'] for x in page['steps']], ['Understand', 'Understand', 'Review', 'Review'])

    def test_file_and_folder_give_the_same_page(self):
        path = self.make()
        a, _ = self.convert(path, 'a.json')
        b, _ = self.convert(os.path.dirname(path), 'b.json')
        self.assertEqual(a, b)

    def test_files_tree(self):
        page, _ = self.convert(self.make())
        self.assertEqual(page['files'], ['payments/', '├─ collect/collect.json', '├─ payments.json', '├─ report/report.json', '└─ triage/triage.json'])

    def test_default_output_is_named_after_the_template(self):
        code, res = self.run_script(self.make())
        self.assertEqual((code, res['path']), (0, self.root + '/payments.page.json'))
        self.assertTrue(os.path.exists(self.root + '/payments.page.json'))


class PageBuild(Base):
    SHELL = '<title>x</title>\n<script type="application/json" id="data">\n{"old": true}\n</script>\n<script>var a = 1</script>'

    def test_page_gets_the_data_block_and_escapes_angle_brackets(self):
        steps = [{'name': 'Go <b>now</b>', 'description': 'a < b'}]
        shell = self.root + '/shell.html'
        with open(shell, 'w') as f:
            f.write(self.SHELL)
        code, res = self.run_script(self.parent(steps), '--page', shell, '-o', self.root + '/page.html')
        self.assertEqual(code, 0, res)
        html = open(self.root + '/page.html').read()
        self.assertNotIn('"old"', html)
        self.assertIn('Go \\u003cb>now\\u003c/b>', html)
        self.assertEqual(html.count('</script>'), 2)
        self.assertTrue(html.endswith('<script>var a = 1</script>'))

    def test_page_needs_an_output_and_a_data_block(self):
        shell = self.root + '/shell.html'
        with open(shell, 'w') as f:
            f.write('<p>no block</p>')
        self.assertEqual(self.run_script(self.parent([{'name': 'a'}]), '--page', shell)[0], 1)
        self.assertEqual(self.run_script(self.parent([{'name': 'a'}]), '--page', shell, '-o', self.root + '/o.html')[0], 1)
        self.assertFalse(os.path.exists(self.root + '/o.html'))


class SubFlowFields(Base):
    def test_trigger_fields_and_a_later_sync_point(self):
        self.write(self.work + '/kid/kid.json', template(CID, 'kid', [{'name': 'one'}]))
        steps = [{'name': 'Go', 'subFlowTrigger': {'template': CID, 'condition': 'when the list is not empty', 'forEach': 'items', 'parameters': {'x': '{{item}}'}, 'syncPoint': 'Merge'}},
                 {'name': 'Docs'}, {'name': 'Merge'}]
        page, _ = self.convert(self.parent(steps))
        self.assertEqual(page['steps'][0]['trigger'], {'condition': 'when the list is not empty', 'parameters': {'x': '{{item}}'}, 'sync': 'Merge', 'syncTo': 2})

    def test_immediate_number_and_unknown_sync_points(self):
        self.write(self.work + '/kid/kid.json', template(CID, 'kid', [{'name': 'one'}]))
        for sync, want in [('immediate', None), ('', None), ('step 3', 2), ('3', 2), ('Nowhere', None), ('Go', None)]:
            steps = [{'name': 'Go', 'subFlowTrigger': {'template': CID, 'syncPoint': sync}}, {'name': 'B'}, {'name': 'C'}]
            page, _ = self.convert(self.parent(steps))
            self.assertEqual(page['steps'][0]['trigger']['syncTo'], want, sync)

    def test_missing_child_keeps_the_id_it_looked_for(self):
        steps = [{'name': 'Go', 'subFlowTrigger': {'template': XID, 'templateName': 'ghost'}}]
        page, _ = self.convert(self.parent(steps))
        self.assertEqual(page['children']['ghost']['id'], XID)


class Edges(Base):
    def test_missing_child_is_a_stub(self):
        steps = [{'name': 'Fan out', 'subFlowTrigger': {'template': XID, 'templateName': 'ghost', 'forEach': 'x'}}]
        page, res = self.convert(self.parent(steps))
        self.assertEqual(page['steps'][0]['child'], 'ghost')
        self.assertEqual(page['children']['ghost'], {'title': 'ghost', 'name': 'ghost', 'params': [], 'steps': [], 'missing': True, 'id': XID})
        self.assertEqual(res['children'], 1)

    def test_child_found_among_sibling_folders(self):
        self.write(self.work + '/kid/kid.json', template(CID, 'kid', [{'name': 'one'}]))
        steps = [{'name': 'Go', 'subFlowTrigger': {'template': CID}}]
        page, _ = self.convert(self.parent(steps))
        self.assertEqual(page['steps'][0]['child'], 'kid')
        self.assertEqual(page['children']['kid']['steps'][0]['name'], 'one')

    def test_cycle_stops(self):
        a = self.install(template(PID, 'alpha', [{'name': 'to b', 'subFlowTrigger': {'template': CID}}]))
        self.install(template(CID, 'beta', [{'name': 'to a', 'subFlowTrigger': {'template': PID}}]))
        page, _ = self.convert(a)
        self.assertEqual(sorted(page['children']), ['alpha', 'beta'])
        self.assertTrue(page['children']['alpha'].get('missing'))
        self.assertEqual(page['children']['beta']['steps'][0]['child'], 'alpha')

    def test_unknown_loop_target_is_dropped(self):
        page, _ = self.convert(self.parent([{'name': 'a'}, {'name': 'b', 'loopBackTo': 'nowhere'}]))
        self.assertNotIn('loop', page['steps'][1])

    def test_every_way_back_is_listed_with_who_sets_it_off(self):
        page, res = self.convert(self.parent([
            {'name': 'a'}, {'name': 'b', 'onVerifierFail': 'a', 'maxIterations': 2},
            {'name': 'c', 'approvalRequired': True, 'routes': [{'label': 'To a', 'goTo': 'a'}, {'label': 'To b', 'goTo': 'b'}]},
            {'name': 'd', 'approvalRequired': True, 'loopBackTo': 'a'}, {'name': 'e', 'loopBackTo': 'a', 'maxIterations': 4}]))
        loops = [s.get('loops') for s in page['steps']]
        self.assertEqual(loops[0], None)
        self.assertEqual(loops[1], [{'to': 0, 'by': 'check', 'max': 2}])
        self.assertEqual(loops[2], [{'to': 0, 'by': 'click', 'label': 'To a', 'max': None}, {'to': 1, 'by': 'click', 'label': 'To b', 'max': None}])
        self.assertEqual(loops[3][0]['by'], 'click')
        self.assertEqual((loops[4][0]['by'], loops[4][0]['max']), ('agent', 4))
        self.assertEqual(res['loops'], 5)

    def test_embedded_step_definition_is_used(self):
        page, _ = self.convert(self.parent([{'name': 'a', 'stepDefinition': {'guidance': {'specificActions': ['do it']}}}]))
        self.assertEqual(page['steps'][0]['actions'], ['do it'])

    def test_bad_path_is_an_error_and_writes_nothing(self):
        code, res = self.run_script(self.root + '/nope.json', '-o', self.root + '/out.json')
        self.assertEqual((code, res['status']), (1, 'error'))
        self.assertFalse(os.path.exists(self.root + '/out.json'))

    def test_not_a_template_is_an_error(self):
        path = self.write(self.work + '/x/x.json', {'type': 'step', 'id': 'i', 'name': 'x'})
        code, res = self.run_script(path, '-o', self.root + '/out.json')
        self.assertEqual((code, res['status']), (1, 'error'))
        self.assertFalse(os.path.exists(self.root + '/out.json'))

    def test_usage_error(self):
        code, res = self.run_script()
        self.assertEqual((code, res['status']), (1, 'error'))


if __name__ == '__main__':
    unittest.main()
