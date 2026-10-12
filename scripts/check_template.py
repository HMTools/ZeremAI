#!/usr/bin/env python3
"""Template check: the exact facts of a flow template, for the create-template skill.

    python3 check_template.py --draft draft.json     # a draft: {template, newSteps, children: [{template, newSteps}]}
    python3 check_template.py --dir TEMPLATE_FOLDER  # written files: <name>.json and <step>/<step>.json

One line of JSON goes to stdout: {"status": "ok"|"error", "findings": [{"at", "level", "text"}]}. A level is
must-fix, should-fix or note. The status is "error" (exit 1) when a finding is must-fix, else "ok" (exit 0).
A template is self-contained: a stepRef is found among its own steps only.

Test hook (environment): FLOW_MANAGER_HOME, the home folder that holds the installed templates.
"""
import json
import os
import re
import sys

from flow_manager import home, list_dir, read_json, registry

UUID4 = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.I)
PLAIN = re.compile(r'^[\w.-]+$')
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
PLACEHOLDER = re.compile(r'\{\{\s*([^{}\s]+)\s*\}\}')
FRAMEWORK_STEPS = ['continuous-improvement', 'complete-flow', 'end-flow-validation']


def slug(text):
    return re.sub(r'[\s_]+', '-', str(text).strip().lower())


def strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from strings(v)


def installed_templates(skip_dir=None):
    """[(category, name, id)] of every installed template, except the one in skip_dir."""
    root = home() + '/.claude/zeremai/templates/flows'
    found = []
    try:
        categories = list_dir(root)
    except OSError:
        return found
    for category, is_dir in categories:
        if not is_dir:
            continue
        for name, is_dir in list_dir(root + '/' + category):
            path = '%s/%s/%s/%s.json' % (root, category, name, name)
            if not is_dir or not os.path.exists(path):
                continue
            if skip_dir and os.path.realpath(os.path.dirname(path)) == os.path.realpath(skip_dir):
                continue
            try:
                data = read_json(path)
            except (OSError, ValueError):
                continue
            if isinstance(data, dict) and data.get('type') == 'template':
                found.append((category, name, data.get('id')))
    return found


def check_template(t, steps, installed, known_ids, prefix=''):
    """Findings of one template. steps: its own step definitions (a stepRef resolves among these only)."""
    out = []

    def add(at, level, text):
        out.append({'at': prefix + at, 'level': level, 'text': text})

    def must(at, text):
        add(at, 'must-fix', text)

    def should(at, text):
        add(at, 'should-fix', text)

    if not isinstance(t, dict):
        must('template', 'The template is not a JSON object.')
        return out
    if t.get('type') != 'template':
        must('type', 'type must be "template".')
    if not (isinstance(t.get('id'), str) and UUID4.match(t['id'])):
        must('id', 'id must be a UUID v4.')
    for key in ['name', 'category']:
        if not (isinstance(t.get(key), str) and PLAIN.match(t[key])):
            must(key, '%s must be a plain name (letters, digits, dot, dash, underscore).' % key)
    meta = t.get('metadata') if isinstance(t.get('metadata'), dict) else {}
    for key in ['title', 'purposeAndUsage']:
        if not (isinstance(meta.get(key), str) and meta[key].strip()):
            must('metadata.' + key, 'metadata.%s is missing.' % key)
    if not (isinstance(meta.get('lastUpdated'), str) and DATE.match(meta['lastUpdated'])):
        must('metadata.lastUpdated', 'metadata.lastUpdated must be a date, YYYY-MM-DD.')

    # parameters
    params = t.get('parameters') if isinstance(t.get('parameters'), dict) else {}
    defs = params.get('definitions') if isinstance(params.get('definitions'), dict) else {}
    for kind in ['required', 'optional']:
        names = params.get(kind)
        if not isinstance(names, list):
            must('parameters.' + kind, 'parameters.%s must be a list.' % kind)
            continue
        for name in names:
            d = defs.get(name)
            if not isinstance(d, dict):
                must('parameters.%s' % name, 'Parameter "%s" has no definition.' % name)
                continue
            for key in ['description', 'type']:
                if not (isinstance(d.get(key), str) and d[key].strip()):
                    must('parameters.%s' % name, 'Parameter "%s" has no %s.' % (name, key))
            if d.get('example') in (None, ''):
                should('parameters.%s' % name, 'Parameter "%s" has no example. The pane shows it in the form.' % name)
    defined = set(defs) | {n for k in ['required', 'optional'] for n in (params.get(k) if isinstance(params.get(k), list) else [])}

    # steps
    by_id = {s.get('id'): s for s in steps if isinstance(s, dict)}
    tsteps = t.get('steps')
    if not (isinstance(tsteps, list) and tsteps):
        must('steps', 'The template has no steps.')
        tsteps = []
    used, earlier = [], []
    for i, s in enumerate(tsteps):
        at = 'steps[%d]' % i
        if not isinstance(s, dict):
            must(at, 'The step is not a JSON object.')
            continue
        name = s.get('name')
        if not (isinstance(name, str) and name.strip()):
            must(at, 'The step has no name.')
        if s.get('number') != i + 1:
            should(at, 'number is %r, expected %d.' % (s.get('number'), i + 1))
        ref, trigger = s.get('stepRef'), s.get('subFlowTrigger')
        file = None
        if ref:
            used.append(ref)
            file = by_id.get(ref)
            if file is None:
                must(at, 'stepRef %s is not a step of this template. A template is self-contained: copy the step into it.' % ref)
        elif not s.get('stepDefinition') and not trigger:
            must(at, 'The step has no stepRef, no stepDefinition and no subFlowTrigger.')
        for label in [name, s.get('stepRefName'), file.get('name') if file else None]:
            if label and slug(label) in FRAMEWORK_STEPS:
                must(at, '"%s" is added by the framework. Remove it from the template.' % label)
                break
        if trigger is not None:
            if not isinstance(trigger, dict) or not trigger.get('template'):
                must(at + '.subFlowTrigger', 'subFlowTrigger.template is missing.')
            elif trigger['template'] not in known_ids and trigger['template'] not in [i[2] for i in installed]:
                must(at + '.subFlowTrigger', 'Sub-flow template %s is not installed and not in the draft.' % trigger['template'])
        back = s.get('loopBackTo')
        if back and back not in earlier:
            must(at, 'loopBackTo "%s" is not the name of an earlier step.' % back)
        # {{x}}: context, sub-flow parameters, description
        loop = isinstance(trigger, dict) and trigger.get('forEach')
        text = list(strings(s.get('context'))) + list(strings(s.get('description'))) + list(strings(trigger.get('parameters') if isinstance(trigger, dict) else None))
        for x in sorted({m for line in text for m in PLACEHOLDER.findall(line)}):
            if x not in defined and not (x == 'item' and loop):
                must(at, '{{%s}} is not a defined parameter.' % x)
        earlier.append(name)

    refs = (t.get('references') or {}).get('steps') if isinstance(t.get('references'), dict) else None
    if set(refs or []) != set(used):
        should('references.steps', 'references.steps must list exactly the stepRefs the steps use.')

    # the same template, installed?
    for category, name, id_ in installed:
        if id_ == t.get('id') and (category, name) != (t.get('category'), t.get('name')):
            must('id', 'This id belongs to the installed template %s/%s.' % (category, name))
        elif (category, name) == (t.get('category'), t.get('name')):
            should('name', 'A template %s/%s is installed. Writing this one would overwrite it.' % (category, name))
    return out


def check_step_files(steps, prefix=''):
    """Findings of the step definitions of one template, plus a duplicate id check inside it."""
    out, seen = [], set()
    for i, s in enumerate(steps):
        at = '%snewSteps[%d]' % (prefix, i)
        if not isinstance(s, dict):
            out.append({'at': at, 'level': 'must-fix', 'text': 'The step file is not a JSON object.'})
            continue
        problems = []
        if s.get('type') != 'step':
            problems.append('type must be "step"')
        if not (isinstance(s.get('id'), str) and UUID4.match(s['id'])):
            problems.append('id must be a UUID v4')
        if not s.get('name'):
            problems.append('name is missing')
        if not (isinstance(s.get('metadata'), dict) and s['metadata'].get('title')):
            problems.append('metadata.title is missing')
        if not s.get('guidance'):
            problems.append('guidance is missing')
        if s.get('id') in seen:
            problems.append('id is used twice')
        seen.add(s.get('id'))
        if s.get('name') and slug(s['name']) in FRAMEWORK_STEPS:
            problems.append('"%s" is added by the framework' % s['name'])
        out += [{'at': at, 'level': 'must-fix', 'text': 'Step file: ' + p + '.'} for p in problems]
    return out


def check_draft(draft):
    if not isinstance(draft, dict) or not isinstance(draft.get('template'), dict):
        return [{'at': 'draft', 'level': 'must-fix', 'text': 'The draft has no template.'}]
    parts = [('', draft['template'], draft.get('newSteps') or [])]
    for i, c in enumerate(draft.get('children') or []):
        parts.append(('children[%d].' % i, (c or {}).get('template'), (c or {}).get('newSteps') or []))
    known = [p[1].get('id') for p in parts if isinstance(p[1], dict)]
    installed = installed_templates()
    out = []
    for prefix, t, steps in parts:
        out += check_step_files(steps, prefix)
        out += check_template(t, steps, installed, known, prefix)
    # ids of new steps are unique across the whole draft
    ids = [s.get('id') for p in parts for s in p[2] if isinstance(s, dict)]
    for id_ in sorted({i for i in ids if ids.count(i) > 1}, key=str):
        out.append({'at': 'newSteps', 'level': 'must-fix', 'text': 'Step id %s is used in more than one step.' % id_})
    return out


def check_dir(folder):
    folder = folder.rstrip('/\\')
    path = '%s/%s.json' % (folder, os.path.basename(folder))
    template = read_json(path)
    steps = []
    for id_, step_path in registry(folder, 'step').items():
        steps.append(read_json(step_path))
    return check_step_files(steps) + check_template(template, steps, installed_templates(folder), [])


def main(argv):
    try:
        if len(argv) != 2 or argv[0] not in ('--draft', '--dir'):
            raise ValueError('Usage: check_template.py --draft FILE | --dir TEMPLATE_FOLDER')
        findings = check_draft(read_json(argv[1])) if argv[0] == '--draft' else check_dir(argv[1])
    except (OSError, ValueError) as e:
        findings = [{'at': 'input', 'level': 'must-fix', 'text': str(e)}]
    bad = any(f['level'] == 'must-fix' for f in findings)
    print(json.dumps({'status': 'error' if bad else 'ok', 'findings': findings}, ensure_ascii=False))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
