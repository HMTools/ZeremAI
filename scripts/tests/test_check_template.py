"""Tests of scripts/check_template.py. The script runs as a subprocess against a temporary HOME."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'check_template.py')
TID, SID, SID2, CID = ['11111111-1111-4111-8111-11111111111%d' % i for i in range(1, 5)]


def step_file(id_=SID, name='diagnose'):
    return {'type': 'step', 'id': id_, 'name': name, 'metadata': {'title': name}, 'guidance': {'specificActions': ['look']}}


def template(**extra):
    t = {
        'type': 'template', 'id': TID, 'name': 'fix-bug', 'category': 'development',
        'metadata': {'title': 'Fix a bug', 'purposeAndUsage': 'Fix a bug.', 'lastUpdated': '2026-10-12'},
        'parameters': {'required': ['bug'], 'optional': [], 'definitions': {'bug': {'description': 'What', 'type': 'string', 'example': 'x'}}},
        'steps': [{'number': 1, 'name': 'Diagnose', 'stepRef': SID, 'context': {'bug': '{{bug}}'}}],
        'references': {'steps': [SID], 'relatedTemplates': [], 'dependencies': []},
    }
    t.update(extra)
    return t


def draft():
    return {'template': template(), 'newSteps': [step_file()], 'copied': [], 'children': [], 'findings': []}


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = os.path.realpath(self._tmp.name)
        self.home = self.root + '/h'
        self.templates = self.home + '/.claude/zeremai/templates/flows'
        self.env = {**os.environ, 'FLOW_MANAGER_HOME': self.home}

    def put(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f)

    def run_check(self, flag, arg):
        p = subprocess.run([sys.executable, SCRIPT, flag, arg], capture_output=True, text=True, env=self.env)
        lines = p.stdout.strip().split('\n')
        self.assertEqual(len(lines), 1, p.stdout + p.stderr)
        out = json.loads(lines[0])
        self.assertEqual(p.returncode, 0 if out['status'] == 'ok' else 1)
        return out

    def check(self, d):
        self.put(self.root + '/draft.json', d)
        return self.run_check('--draft', self.root + '/draft.json')

    def bad(self, d, text, at=None, level='must-fix'):
        out = self.check(d)
        hits = [f for f in out['findings'] if text in f['text'] and f['level'] == level]
        self.assertTrue(hits, out)
        if at:
            self.assertEqual(hits[0]['at'], at)
        self.assertEqual(out['status'], 'error' if level == 'must-fix' else out['status'])

    def edit(self, fn):
        d = draft()
        fn(d)
        return d


class Good(Base):
    def test_good_draft(self):
        self.assertEqual(self.check(draft()), {'status': 'ok', 'findings': []})

    def test_good_folder(self):
        folder = self.root + '/fix-bug'
        self.put(folder + '/fix-bug.json', template())
        self.put(folder + '/diagnose/diagnose.json', step_file())
        self.assertEqual(self.run_check('--dir', folder), {'status': 'ok', 'findings': []})

    def test_bad_usage_and_unreadable_file(self):
        for args in [['--draft'], ['--draft', self.root + '/nope.json']]:
            p = subprocess.run([sys.executable, SCRIPT] + args, capture_output=True, text=True, env=self.env)
            out = json.loads(p.stdout)
            self.assertEqual((p.returncode, out['status'], len(out['findings'])), (1, 'error', 1))


class TemplateFields(Base):
    def test_type(self):
        self.bad(self.edit(lambda d: d['template'].update(type='step')), 'type must be "template"', 'type')

    def test_id_is_uuid_v4(self):
        self.bad(self.edit(lambda d: d['template'].update(id='abc')), 'UUID v4', 'id')

    def test_plain_names(self):
        self.bad(self.edit(lambda d: d['template'].update(name='a b')), 'plain name', 'name')
        self.bad(self.edit(lambda d: d['template'].update(category='../x')), 'plain name', 'category')

    def test_metadata(self):
        self.bad(self.edit(lambda d: d['template']['metadata'].pop('title')), 'metadata.title', 'metadata.title')
        self.bad(self.edit(lambda d: d['template']['metadata'].pop('purposeAndUsage')), 'metadata.purposeAndUsage')
        self.bad(self.edit(lambda d: d['template']['metadata'].update(lastUpdated='12/10/2026')), 'YYYY-MM-DD')

    def test_parameter_lists(self):
        self.bad(self.edit(lambda d: d['template']['parameters'].update(required='bug')), 'must be a list', 'parameters.required')

    def test_parameter_without_definition(self):
        self.bad(self.edit(lambda d: d['template']['parameters']['optional'].append('focus')), 'no definition', 'parameters.focus')

    def test_parameter_without_description_or_type(self):
        self.bad(self.edit(lambda d: d['template']['parameters']['definitions']['bug'].pop('description')), 'no description', 'parameters.bug')
        self.bad(self.edit(lambda d: d['template']['parameters']['definitions']['bug'].pop('type')), 'no type', 'parameters.bug')

    def test_parameter_without_example_is_should_fix(self):
        out = self.check(self.edit(lambda d: d['template']['parameters']['definitions']['bug'].pop('example')))
        self.assertEqual(out['status'], 'ok')
        self.assertEqual([(f['at'], f['level']) for f in out['findings']], [('parameters.bug', 'should-fix')])

    def test_steps_not_empty(self):
        self.bad(self.edit(lambda d: d['template'].update(steps=[])), 'no steps', 'steps')

    def test_step_name(self):
        self.bad(self.edit(lambda d: d['template']['steps'][0].pop('name')), 'no name', 'steps[0]')

    def test_step_numbers_are_should_fix(self):
        out = self.check(self.edit(lambda d: d['template']['steps'][0].update(number=3)))
        self.assertEqual([(f['at'], f['level']) for f in out['findings']], [('steps[0]', 'should-fix')])


class StepRefs(Base):
    def test_unknown_stepref(self):
        self.bad(self.edit(lambda d: d['template']['steps'][0].update(stepRef=SID2)), 'not a step of this template', 'steps[0]')

    def test_installed_templates_never_resolve_a_stepref(self):
        # the step exists in another installed template: still not a step of this one
        other = template(id=CID, name='other')
        self.put(self.templates + '/development/other/other.json', other)
        self.put(self.templates + '/development/other/diagnose/diagnose.json', step_file(SID2))
        self.bad(self.edit(lambda d: d['template']['steps'][0].update(stepRef=SID2)), 'not a step of this template')

    def test_step_without_ref_definition_or_trigger(self):
        def f(d):
            d['template']['steps'][0].pop('stepRef')
            d['template']['references']['steps'] = []
        self.bad(self.edit(f), 'no stepRef, no stepDefinition and no subFlowTrigger', 'steps[0]')

    def test_inline_step_definition_is_fine(self):
        def f(d):
            d['template']['steps'][0].pop('stepRef')
            d['template']['steps'][0]['stepDefinition'] = {'guidance': {}}
            d['template']['references']['steps'] = []
            d['newSteps'] = []
        self.assertEqual(self.check(self.edit(f))['status'], 'ok')

    def test_step_file_fields(self):
        self.bad(self.edit(lambda d: d['newSteps'][0].update(type='template')), 'type must be "step"', 'newSteps[0]')
        self.bad(self.edit(lambda d: d['newSteps'][0].update(id='nope')), 'UUID v4', 'newSteps[0]')
        self.bad(self.edit(lambda d: d['newSteps'][0].pop('guidance')), 'guidance is missing')
        self.bad(self.edit(lambda d: d['newSteps'][0].pop('metadata')), 'metadata.title is missing')

    def test_step_ids_unique_across_draft(self):
        def f(d):
            d['children'] = [{'template': template(id=CID, name='child'), 'newSteps': [step_file()]}]
        self.bad(self.edit(f), 'used in more than one step', 'newSteps')

    def test_references_steps_should_fix(self):
        out = self.check(self.edit(lambda d: d['template']['references'].update(steps=[])))
        self.assertEqual([(f['at'], f['level']) for f in out['findings']], [('references.steps', 'should-fix')])


class Placeholders(Base):
    def test_undefined_placeholder(self):
        self.bad(self.edit(lambda d: d['template']['steps'][0]['context'].update(x='{{nope}}')), '{{nope}} is not a defined parameter', 'steps[0]')

    def test_placeholder_in_description_and_trigger_parameters(self):
        self.bad(self.edit(lambda d: d['template']['steps'][0].update(description='see {{ghost}}')), '{{ghost}}')

    def test_item_needs_for_each(self):
        def f(d):
            d['template']['steps'][0]['description'] = '{{item}}'
        self.bad(self.edit(f), '{{item}}')

        def g(d):
            d['template']['steps'][0]['subFlowTrigger'] = {'template': TID, 'forEach': 'files', 'parameters': {'f': '{{item}}'}}
            d['template']['steps'][0]['stepRef'] = SID
        out = self.check(self.edit(g))
        self.assertFalse([f for f in out['findings'] if '{{item}}' in f['text']], out)


class FrameworkSteps(Base):
    def test_framework_step_names(self):
        for name in ['Continuous Improvement', 'complete-flow', 'End Flow Validation']:
            self.bad(self.edit(lambda d, n=name: d['template']['steps'][0].update(name=n)), 'added by the framework', 'steps[0]')

    def test_by_ref_name_and_step_file_name(self):
        self.bad(self.edit(lambda d: d['template']['steps'][0].update(stepRefName='complete-flow')), 'added by the framework')
        self.bad(self.edit(lambda d: d['newSteps'][0].update(name='continuous-improvement')), 'added by the framework')


class SubFlows(Base):
    def trigger(self, d, template_id):
        d['template']['steps'].append({'number': 2, 'name': 'Each', 'subFlowTrigger': {'template': template_id}})

    def test_missing_template(self):
        self.bad(self.edit(lambda d: d['template']['steps'].append({'number': 2, 'name': 'Each', 'subFlowTrigger': {}})), 'subFlowTrigger.template is missing', 'steps[1].subFlowTrigger')

    def test_unknown_template(self):
        self.bad(self.edit(lambda d: self.trigger(d, CID)), 'not installed and not in the draft', 'steps[1].subFlowTrigger')

    def test_template_in_the_draft(self):
        def f(d):
            self.trigger(d, CID)
            d['children'] = [{'template': template(id=CID, name='child', steps=[{'number': 1, 'name': 'Do', 'stepRef': SID2}], references={'steps': [SID2]}), 'newSteps': [step_file(SID2, 'do')]}]
        self.assertEqual(self.check(self.edit(f)), {'status': 'ok', 'findings': []})

    def test_installed_template(self):
        self.put(self.templates + '/development/other/other.json', template(id=CID, name='other'))
        self.assertEqual(self.check(self.edit(lambda d: self.trigger(d, CID)))['status'], 'ok')

    def test_child_findings_are_prefixed(self):
        def f(d):
            d['children'] = [{'template': template(id=CID, name='child', type='x', steps=[{'number': 1, 'name': 'Do', 'stepRef': SID2}], references={'steps': [SID2]}), 'newSteps': [step_file(SID2, 'do')]}]
        self.bad(self.edit(f), 'type must be "template"', 'children[0].type')


class Loops(Base):
    def test_loop_back_to_unknown_or_later_step(self):
        def f(d):
            d['template']['steps'][0]['loopBackTo'] = 'Later'
            d['template']['steps'].append({'number': 2, 'name': 'Later', 'stepRef': SID})
        self.bad(self.edit(f), 'loopBackTo "Later"', 'steps[0]')

    def test_loop_back_to_earlier_step(self):
        def f(d):
            d['template']['steps'].append({'number': 2, 'name': 'Again', 'stepRef': SID, 'loopBackTo': 'Diagnose'})
        self.assertEqual(self.check(self.edit(f))['status'], 'ok')


class Installed(Base):
    def test_same_name_is_should_fix(self):
        self.put(self.templates + '/development/fix-bug/fix-bug.json', template(id=CID))
        out = self.check(draft())
        self.assertEqual(out['status'], 'ok')
        self.assertEqual([(f['at'], f['level']) for f in out['findings']], [('name', 'should-fix')])
        self.assertIn('overwrite', out['findings'][0]['text'])

    def test_same_id_other_name_is_must_fix(self):
        self.put(self.templates + '/development/other/other.json', template(name='other'))
        self.bad(draft(), 'belongs to the installed template development/other', 'id')

    def test_folder_already_installed_does_not_clash_with_itself(self):
        folder = self.templates + '/development/fix-bug'
        self.put(folder + '/fix-bug.json', template())
        self.put(folder + '/diagnose/diagnose.json', step_file())
        self.assertEqual(self.run_check('--dir', folder), {'status': 'ok', 'findings': []})


class DirMode(Base):
    def test_stepref_must_be_a_step_file_of_the_folder(self):
        folder = self.root + '/fix-bug'
        self.put(folder + '/fix-bug.json', template())
        out = self.run_check('--dir', folder)
        self.assertTrue([f for f in out['findings'] if 'not a step of this template' in f['text']], out)


CID2 = '11111111-1111-4111-8111-111111111115'
SID3 = '11111111-1111-4111-8111-111111111116'


class MarketplaceMode(Base):
    def repo(self, category='development', name='fix-bug', **extra):
        """Write one template with its step file under self.root/mkt. Returns its folder."""
        folder = '%s/mkt/templates/flows/%s/%s' % (self.root, category, name)
        self.put(folder + '/%s.json' % name, template(name=name, category=category, **extra))
        self.put(folder + '/diagnose/diagnose.json', step_file())
        return folder

    def run_mkt(self):
        return self.run_check('--marketplace', self.root + '/mkt')

    def finds(self, out, text, at=None, level='must-fix'):
        hit = [f for f in out['findings'] if text in f['text'] and f['level'] == level and (at is None or f['at'] == at)]
        self.assertTrue(hit, out)

    def test_not_a_marketplace(self):
        os.makedirs(self.root + '/mkt')
        self.finds(self.run_mkt(), 'not a marketplace: templates/flows not found')

    def test_no_templates_yet_is_a_note(self):
        os.makedirs(self.root + '/mkt/templates/flows/review')
        out = self.run_mkt()
        self.assertEqual(out, {'status': 'ok', 'findings': [{'at': 'templates/flows', 'level': 'note', 'text': 'no templates yet'}]})

    def test_template_json_missing(self):
        os.makedirs(self.root + '/mkt/templates/flows/review/pr-review')
        self.finds(self.run_mkt(), 'Cannot read pr-review.json', 'review/pr-review: template')

    def test_folder_must_match_name_and_category(self):
        folder = self.repo()
        self.put(folder + '/fix-bug.json', template(name='other', category='testing'))
        out = self.run_mkt()
        self.finds(out, "name is 'other' but its folder is 'fix-bug'", 'development/fix-bug: name')
        self.finds(out, "category is 'testing' but its folder is 'development'", 'development/fix-bug: category')

    def test_ids_are_unique_across_the_repo(self):
        self.repo()
        self.repo('review', 'pr-review')  # same TID
        self.finds(self.run_mkt(), 'id %s is already used by development/fix-bug' % TID, 'review/pr-review: id')

    def test_findings_of_a_template_are_prefixed(self):
        folder = self.repo()
        self.put(folder + '/fix-bug.json', template(steps=[{'number': 1, 'name': 'Diagnose', 'stepRef': SID3, 'context': {'bug': '{{bug}}'}}]))
        self.finds(self.run_mkt(), 'not a step of this template', 'development/fix-bug: steps[0]')

    def test_good_repo_with_a_sub_flow_to_the_other_template(self):
        self.repo('review', 'pr-review', id=CID2)
        self.repo(steps=[
            {'number': 1, 'name': 'Diagnose', 'stepRef': SID, 'context': {'bug': '{{bug}}'}},
            {'number': 2, 'name': 'Review', 'subFlowTrigger': {'template': CID2, 'syncPoint': 'immediate'}},
        ])
        self.assertEqual(self.run_mkt(), {'status': 'ok', 'findings': []})

    def test_sub_flow_to_a_template_nowhere_is_must_fix(self):
        self.repo(steps=[{'number': 1, 'name': 'Diagnose', 'stepRef': SID, 'context': {'bug': '{{bug}}'}},
                         {'number': 2, 'name': 'Review', 'subFlowTrigger': {'template': CID2, 'syncPoint': 'immediate'}}])
        self.finds(self.run_mkt(), 'is not installed', 'development/fix-bug: steps[1].subFlowTrigger')

    def test_installed_copy_is_not_an_overwrite_warning(self):
        self.repo()
        self.put(self.templates + '/development/fix-bug/fix-bug.json', template())
        self.assertEqual(self.run_mkt(), {'status': 'ok', 'findings': []})

    def test_underscore_categories_and_plain_files_are_ignored(self):
        self.repo()
        os.makedirs(self.root + '/mkt/templates/flows/_drafts/broken')  # would be must-fix if it counted
        with open(self.root + '/mkt/templates/flows/README.md', 'w') as f:
            f.write('x')
        self.assertEqual(self.run_mkt(), {'status': 'ok', 'findings': []})


if __name__ == '__main__':
    unittest.main()
