#!/usr/bin/env python3
"""Template check: the exact facts of a flow template, for the create-template skill.

    python3 check_template.py --draft draft.json     # a draft: {template, newSteps, children: [{template, newSteps}]}
    python3 check_template.py --dir TEMPLATE_FOLDER  # written files: <name>.json and <step>/<step>.json
    python3 check_template.py --marketplace DIR      # a repo: templates/flows/<category>/<name>/, every template

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
VERSION = re.compile(r'^\d+\.\d+\.\d+$')
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


def handoff(s, i, tsteps, at, lookup, installed, should):
    """Should-fix findings of a sub-flow step: where the parent waits, and what it passes to the child."""
    key = 'subFlowTrigger' if isinstance(s.get('subFlowTrigger'), dict) else 'subFlowConfig' if isinstance(s.get('subFlowConfig'), dict) else None
    cfg = s.get(key) if key else None
    if not cfg or not cfg.get('template'):
        return
    where = at + '.' + key
    sync = cfg.get('syncPoint') if key == 'subFlowTrigger' else cfg.get('sync')
    if isinstance(sync, str) and sync.strip():
        low, later = sync.strip().lower(), [str(x.get('name', '')).strip().lower() for x in tsteps[i + 1:] if isinstance(x, dict)]
        num = re.match(r'^(?:step\s*)?(\d+)$', low)
        if low != 'immediate' and low not in later and not (num and i + 1 < int(num.group(1)) <= len(tsteps)):
            should(where, "Sync point %s is not 'immediate' and not a later step of this template." % sync)
    child = child_of(cfg['template'], lookup, installed)
    if not isinstance(child, dict):
        return
    cname = child.get('name', cfg['template'])
    cparams = child.get('parameters') if isinstance(child.get('parameters'), dict) else {}
    required = cparams.get('required') if isinstance(cparams.get('required'), list) else []
    known = set(required) | set(cparams.get('optional') if isinstance(cparams.get('optional'), list) else []) | set(cparams.get('definitions') if isinstance(cparams.get('definitions'), dict) else {})
    passed = cfg.get('parameters') if key == 'subFlowTrigger' else cfg.get('parameterMapping')
    passed = passed if isinstance(passed, dict) else {}
    for p in required:
        if p not in passed:
            should(where, 'Child %s needs required parameter %s, but this step does not pass it.' % (cname, p))
    for k in passed:
        if k not in known:
            should(where, 'This step passes %s, but child %s has no such parameter.' % (k, cname))


def child_of(id_, lookup, installed):
    """The template with this id: from the draft or repo (lookup), else an installed one. None when it cannot be found."""
    if id_ in lookup:
        return lookup[id_]
    root = home() + '/.claude/zeremai/templates/flows'
    for category, name, i in installed:
        if i == id_:
            try:
                return read_json('%s/%s/%s/%s.json' % (root, category, name, name))
            except (OSError, ValueError):
                return None
    return None


def check_template(t, steps, installed, known_ids, prefix='', overwrite=True, lookup=None):
    """Findings of one template. steps: its own step definitions (a stepRef resolves among these only).
    lookup: {id: template} of the other templates of the draft or the repo, for the sub-flow hand-off checks."""
    out = []
    lookup = lookup or {}

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
    if not (isinstance(meta.get('version'), str) and VERSION.match(meta['version'])):
        must('metadata.version', 'metadata.version must be a version like 1.0.0.')

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
            opts = d.get('options')
            if opts is not None:
                if not (isinstance(opts, list) and opts and all(isinstance(o, str) and o.strip() for o in opts) and len(set(opts)) == len(opts)):
                    must('parameters.%s' % name, 'Parameter "%s": options must be a list of unique, non-empty texts.' % name)
                elif d.get('example') not in (None, '') and d['example'] not in opts and d.get('allowOther') is not True:
                    should('parameters.%s' % name, 'Parameter "%s": the example is not one of the options.' % name)
            if d.get('allowOther') is not None and opts is None:
                should('parameters.%s' % name, 'Parameter "%s" has allowOther but no options.' % name)
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
        handoff(s, i, tsteps, at, lookup, installed, should)
        back = s.get('loopBackTo')
        if back and back not in earlier:
            must(at, 'loopBackTo "%s" is not the name of an earlier step.' % back)
        routes = s.get('routes')
        if routes is not None:
            if not s.get('approvalRequired'):
                must(at, 'routes need approvalRequired: a Back button is a click on an approval step.')
            if not (isinstance(routes, list) and routes):
                must(at + '.routes', 'routes must be a non-empty list.')
            else:
                labels = []
                for j, r in enumerate(routes):
                    where = '%s.routes[%d]' % (at, j)
                    if not (isinstance(r, dict) and isinstance(r.get('label'), str) and r['label'].strip() and isinstance(r.get('goTo'), str)):
                        must(where, 'A route needs a label and a goTo.')
                        continue
                    if r['label'] in labels:
                        must(where, 'The label "%s" is used twice.' % r['label'])
                    labels.append(r['label'])
                    if r['goTo'] not in earlier:
                        must(where, 'goTo "%s" is not the name of an earlier step.' % r['goTo'])
        onfail = s.get('onVerifierFail')
        if onfail is not None:
            if onfail not in earlier:
                must(at, 'onVerifierFail "%s" is not the name of an earlier step.' % onfail)
            elif file is not None and not file.get('verifiers'):
                should(at, 'onVerifierFail has no effect: the step has no verifiers.')
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
        elif overwrite and (category, name) == (t.get('category'), t.get('name')):
            should('name', 'A template %s/%s is installed. Writing this one would overwrite it.' % (category, name))
    return out


def verifier_problems(s):
    """Shape of the verifiers and maxFixes of a step file."""
    out = []
    if 'verifiers' in s and not isinstance(s['verifiers'], list):
        return ['verifiers must be a list']
    for v in s.get('verifiers') or []:
        script = v.get('script') if isinstance(v, dict) else None
        if not (isinstance(script, str) and re.match(r'^[\w.-]+\.py$', script)):
            out.append('a verifier needs "script": a .py file name in the step folder')
        if isinstance(v, dict) and 'timeoutSec' in v and not (isinstance(v['timeoutSec'], (int, float)) and not isinstance(v['timeoutSec'], bool) and 0 < v['timeoutSec'] <= 8):
            out.append('timeoutSec must be a number above 0 and up to 8')
    if 'maxFixes' in s and not (isinstance(s['maxFixes'], int) and not isinstance(s['maxFixes'], bool) and 0 <= s['maxFixes'] <= 5):
        out.append('maxFixes must be a whole number from 0 to 5')
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
        problems += verifier_problems(s)
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
    lookup = {p[1].get('id'): p[1] for p in parts if isinstance(p[1], dict)}
    installed = installed_templates()
    out = []
    for prefix, t, steps in parts:
        out += check_step_files(steps, prefix)
        out += check_template(t, steps, installed, known, prefix, lookup=lookup)
    # ids of new steps are unique across the whole draft
    ids = [s.get('id') for p in parts for s in p[2] if isinstance(s, dict)]
    for id_ in sorted({i for i in ids if ids.count(i) > 1}, key=str):
        out.append({'at': 'newSteps', 'level': 'must-fix', 'text': 'Step id %s is used in more than one step.' % id_})
    return out


def check_changelog(folder, template):
    # changelog.json: {"versions": [{"version": "1.3.0", "date": "YYYY-MM-DD", "changes": ["text", ...]}]}, newest first.
    # It must have an entry for the current metadata.version, so an update can say what changed.
    path = os.path.join(folder, 'changelog.json')
    meta = template.get('metadata') if isinstance(template, dict) and isinstance(template.get('metadata'), dict) else {}
    try:
        log = read_json(path)
    except (OSError, ValueError):
        return [{'at': 'changelog.json', 'level': 'must-fix', 'text': 'changelog.json is missing or is not JSON.'}]
    rows = log.get('versions') if isinstance(log, dict) else None
    if not isinstance(rows, list):
        return [{'at': 'changelog.json', 'level': 'must-fix', 'text': 'changelog.json needs a "versions" list.'}]
    out = []
    for r in rows:
        ok = isinstance(r, dict) and isinstance(r.get('version'), str) and VERSION.match(r['version']) and isinstance(r.get('date'), str) and DATE.match(r['date']) \
            and isinstance(r.get('changes'), list) and r['changes'] and all(isinstance(c, str) and c.strip() for c in r['changes'])
        if not ok:
            out.append({'at': 'changelog.json', 'level': 'must-fix', 'text': 'Each entry needs version x.y.z, date YYYY-MM-DD and a list of changes (plain sentences).'})
            break
    if meta.get('version') and not any(isinstance(r, dict) and r.get('version') == meta['version'] for r in rows):
        out.append({'at': 'changelog.json', 'level': 'must-fix', 'text': 'changelog.json has no entry for version %s.' % meta['version']})
    return out


def check_dir(folder, known=(), overwrite=True, lookup=None):
    folder = folder.rstrip('/\\')
    path = '%s/%s.json' % (folder, os.path.basename(folder))
    template = read_json(path)
    steps = []
    missing = []
    for id_, step_path in registry(folder, 'step').items():
        step = read_json(step_path)
        steps.append(step)
        for v in step['verifiers'] if isinstance(step.get('verifiers'), list) else []:
            script = v.get('script') if isinstance(v, dict) else None
            if isinstance(script, str) and not os.path.isfile(os.path.join(os.path.dirname(step_path), script)):
                missing.append({'at': step.get('name', id_), 'level': 'must-fix', 'text': 'Step file: verifier "%s" is not in the step folder.' % script})
    return missing + check_changelog(folder, template) + check_step_files(steps) + check_template(template, steps, installed_templates(folder), list(known), overwrite=overwrite, lookup=lookup)


def check_marketplace(root):
    base = root.rstrip('/\\') + '/templates/flows'
    if not os.path.isdir(base):
        return [{'at': 'templates/flows', 'level': 'must-fix', 'text': 'not a marketplace: templates/flows not found'}]
    found = []  # (category, name, folder)
    for category, is_dir in sorted(list_dir(base)):
        if is_dir and not category.startswith('_'):
            found += [(category, n, '%s/%s/%s' % (base, category, n)) for n, d in sorted(list_dir(base + '/' + category)) if d]
    if not found:
        return [{'at': 'templates/flows', 'level': 'note', 'text': 'no templates yet'}]
    loaded, out, first = [], [], {}
    for category, name, folder in found:
        at = '%s/%s: ' % (category, name)
        try:
            t = read_json('%s/%s.json' % (folder, name))
        except (OSError, ValueError) as e:
            out.append({'at': at + 'template', 'level': 'must-fix', 'text': 'Cannot read %s.json: %s' % (name, e)})
            continue
        loaded.append((category, name, folder, t))
        if isinstance(t, dict):
            for key, want in [('name', name), ('category', category)]:
                if t.get(key) != want:
                    out.append({'at': at + key, 'level': 'must-fix', 'text': '%s is %r but its folder is %r.' % (key, t.get(key), want)})
            if t.get('id') in first:
                out.append({'at': at + 'id', 'level': 'must-fix', 'text': 'id %s is already used by %s.' % (t.get('id'), first[t['id']])})
            first.setdefault(t.get('id'), '%s/%s' % (category, name))
    known = [t.get('id') for _, _, _, t in loaded if isinstance(t, dict)]
    lookup = {t.get('id'): t for _, _, _, t in loaded if isinstance(t, dict)}
    for category, name, folder, _ in loaded:
        try:
            found_here = check_dir(folder, known, overwrite=False, lookup=lookup)
        except (OSError, ValueError) as e:
            found_here = [{'at': 'template', 'level': 'must-fix', 'text': str(e)}]
        out += [dict(f, at='%s/%s: %s' % (category, name, f['at'])) for f in found_here]
    return out


def main(argv):
    try:
        if len(argv) != 2 or argv[0] not in ('--draft', '--dir', '--marketplace'):
            raise ValueError('Usage: check_template.py --draft FILE | --dir TEMPLATE_FOLDER | --marketplace DIR')
        findings = {'--draft': lambda: check_draft(read_json(argv[1])), '--dir': lambda: check_dir(argv[1]), '--marketplace': lambda: check_marketplace(argv[1])}[argv[0]]()
    except (OSError, ValueError) as e:
        findings = [{'at': 'input', 'level': 'must-fix', 'text': str(e)}]
    bad = any(f['level'] == 'must-fix' for f in findings)
    print(json.dumps({'status': 'error' if bad else 'ok', 'findings': findings}, ensure_ascii=False))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
