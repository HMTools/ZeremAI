#!/usr/bin/env python3
"""Template to page data: turns an installed template into the JSON the template page reads.

    python3 template_to_page.py PATH [-o OUT]            # PATH: a template JSON file, or its folder
    python3 template_to_page.py PATH --page PAGE.html -o OUT.html   # also builds the finished page

One line of JSON goes to stdout: {"status": "ok", "path", "steps", "approvals", "loops", "children"}, or
{"status": "error", "message"} with exit 1. OUT defaults to `<template name>.page.json` in the current folder. With --page, OUT is the page: PAGE.html with its
<script type="application/json" id="data"> block replaced by the data (needs -o).
A step is found in the template's own folder only. A child template (a sub-flow target) is found by its id
among the sibling template folders, then among the installed templates.

Test hook (environment): FLOW_MANAGER_HOME, the home folder that holds the installed templates.
"""
import json
import os
import re
import sys

from check_template import PLACEHOLDER, installed_templates, strings
from flow_manager import home, list_dir, read_json, registry

MAX_DEPTH = 3


def text(x):
    return x if isinstance(x, str) else ''


def params_of(t):
    spec = t.get('parameters') or {}
    defs = spec.get('definitions') or {}
    out = []
    for required, names in ((True, spec.get('required')), (False, spec.get('optional'))):
        for n in names or []:
            d = defs.get(n)
            d = d if isinstance(d, dict) else {}
            out.append({'name': n, 'required': required, 'type': str(d.get('type') or 'text'), 'description': text(d.get('description')), 'example': str(d.get('example') or '')})
    return out


def actions_of(definition):
    acts = (definition.get('guidance') or {}).get('specificActions')
    if isinstance(acts, list) and acts:
        return [str(a) for a in acts]
    flat = []
    for sub in definition.get('substeps') or []:
        if isinstance(sub, dict):
            flat += [str(a) for a in sub.get('actions') or []]
    return flat


def output_of(definition):
    o = definition.get('output') or {}
    out = [o.get('description')] + list(o.get('artifacts') or []) + ['Memory: ' + str(m) for m in o.get('memoryUpdates') or []]
    return [str(x) for x in out if x]


def label(a, b):
    return 'Step %d' % a if a == b else 'Steps %d–%d' % (a, b)


def phases(raw):
    """The step's own phase, else the stretch up to and including each approval."""
    groups, start = {}, 0
    for i, d in enumerate(raw):
        if d.get('approvalRequired'):
            groups.update({k: label(start + 1, i + 1) for k in range(start, i + 1)})
            start = i + 1
    groups.update({k: label(start + 1, len(raw)) for k in range(start, len(raw))})
    out, prev = [], None
    for i, d in enumerate(raw):
        mine = text(d.get('phase')) or (prev if any(x.get('phase') for x in raw) and prev else groups[i])
        out.append(mine)
        prev = mine
    return out


def find_template(tid, folder):
    """Path of the template with this id: a sibling folder first, then the installed ones."""
    parent = os.path.dirname(folder)
    paths = []
    try:
        paths += ['%s/%s/%s.json' % (parent, n, n) for n, is_dir in list_dir(parent) if is_dir]
    except OSError:
        pass
    root = home() + '/.claude/zeremai/templates/flows'
    paths += ['%s/%s/%s/%s.json' % (root, c, n, n) for c, n, _ in installed_templates()]
    for p in paths:
        try:
            d = read_json(p)
        except (OSError, ValueError):
            continue
        if isinstance(d, dict) and d.get('type') == 'template' and d.get('id') == tid:
            return p
    return None


def stub(name, tid=None):
    d = {'title': name, 'name': name, 'params': [], 'steps': [], 'missing': True}
    if tid:
        d['id'] = str(tid)
    return d


def sync_to(sync, names, i):
    """Index of the later step of this template that the sync point names (by name, by number or "step N"), else None."""
    s = sync.strip().lower()
    if not s or s == 'immediate':
        return None
    m = re.fullmatch(r'(?:step\s*)?(\d+)', s)
    k = int(m.group(1)) - 1 if m else names.index(s) if s in names else -1
    return k if k > i and k < len(names) else None


def convert(path, children, stack):
    t = read_json(path)
    if not isinstance(t, dict) or t.get('type') != 'template':
        raise ValueError('Not a template: ' + path)
    folder = os.path.dirname(path)
    files = registry(folder, 'step')
    params = params_of(t)
    defined = {p['name'] for p in params}
    raw = [d for d in t.get('steps') or [] if isinstance(d, dict)]
    names = [text(d.get('name')).lower() for d in raw]
    ph = phases(raw)
    steps = []
    for i, d in enumerate(raw):
        ref = d.get('stepRef')
        definition = read_json(files[ref]) if ref in files else (d.get('stepDefinition') or {})
        name = text(d.get('name')) or text(definition.get('name')) or 'Step %d' % (i + 1)
        trig = d.get('subFlowTrigger') or d.get('subFlowConfig')
        step = {'name': name, 'kind': 'sub' if trig else 'new', 'phase': ph[i], 'approval': bool(d.get('approvalRequired')),
                'summary': text(d.get('description')) or text((definition.get('metadata') or {}).get('purposeAndUsage')) or name,
                'actions': actions_of(definition), 'output': output_of(definition),
                'uses': sorted({m.group(1) for s in list(strings(d)) + list(strings(definition)) for m in PLACEHOLDER.finditer(s)} & defined)}
        back = text(d.get('loopBackTo')).lower()
        if back and back in names:
            step['loop'] = {'to': names.index(back), 'max': d.get('maxIterations') or 1, 'when': text(d.get('loopCondition'))}
        if trig:
            step['forEach'] = text(trig.get('forEach') or trig.get('iterateOver'))
            passed = trig.get('parameters') or trig.get('parameterMapping') or {}
            sync = text(trig.get('syncPoint') or trig.get('sync'))
            step['trigger'] = {'condition': text(trig.get('condition')), 'parameters': {str(k): str(v) for k, v in passed.items()} if isinstance(passed, dict) else {},
                               'sync': sync, 'syncTo': sync_to(sync, names, i)}
            step['child'] = child_of(trig, folder, children, stack + [os.path.realpath(path)])
        steps.append(step)
    meta = t.get('metadata') or {}
    return {'title': text(meta.get('title')) or text(t.get('name')), 'category': t.get('category'), 'name': t.get('name'), 'purpose': text(meta.get('purposeAndUsage')),
            'params': params, 'steps': steps}


def child_of(trig, folder, children, stack):
    tid = trig.get('template')
    fallback = text(trig.get('templateName')) or str(tid)
    p = find_template(tid, folder) if tid else None
    if not p:
        children.setdefault(fallback, stub(fallback, tid))
        return fallback
    name = text(read_json(p).get('name')) or fallback
    if name not in children:
        if os.path.realpath(p) in stack or len(stack) >= MAX_DEPTH:
            children[name] = stub(name)
        else:
            children[name] = None  # holds the place while its own children are read
            c = convert(p, children, stack)
            children[name] = {k: c[k] for k in ('title', 'name', 'params', 'steps')}
    return name


def tree(folder):
    lines = [os.path.basename(folder) + '/']
    entries = []
    for n, is_dir in list_dir(folder):
        inner = '%s/%s/%s.json' % (folder, n, n)
        entries.append(n + '/' + n + '.json' if is_dir and os.path.exists(inner) else n + '/' if is_dir else n)
    for i, e in enumerate(entries):
        lines.append(('└─ ' if i == len(entries) - 1 else '├─ ') + e)
    return lines


def build(path):
    if os.path.isdir(path):
        path = '%s/%s.json' % (path.rstrip('/\\'), os.path.basename(path.rstrip('/\\')))
    children = {}
    page = convert(path, children, [])
    page = dict({'mode': 'view'}, **page, children=children, findings=None, files=tree(os.path.dirname(path)))
    return page


def main(argv):
    try:
        out = None
        if '-o' in argv:
            i = argv.index('-o')
            out, argv = argv[i + 1], argv[:i] + argv[i + 2:]
        shell = None
        if '--page' in argv:
            i = argv.index('--page')
            shell, argv = argv[i + 1], argv[:i] + argv[i + 2:]
            if out is None:
                raise ValueError('--page needs -o OUT.html')
        if len(argv) != 1:
            raise ValueError('Usage: template_to_page.py PATH [-o OUT] [--page PAGE.html]')
        page = build(argv[0])
        out = os.path.abspath(out or '%s.page.json' % page['name'])
        if shell:
            with open(shell, encoding='utf-8') as f:
                html = f.read()
            mark = re.search(r'(<script type="application/json" id="data">\n)(.*?)(\n</script>)', html, re.S)
            if not mark:
                raise ValueError('No data block in ' + shell)
            data = json.dumps(page, ensure_ascii=False, indent=1).replace('<', '\\u003c')
            html = html[:mark.start(2)] + data + html[mark.end(2):]
            with open(out, 'w', encoding='utf-8') as f:
                f.write(html)
        else:
            with open(out, 'w', encoding='utf-8') as f:
                json.dump(page, f, ensure_ascii=False, indent=2)
        print(json.dumps({'status': 'ok', 'path': out, 'steps': len(page['steps']), 'approvals': sum(s['approval'] for s in page['steps']),
                          'loops': sum('loop' in s for s in page['steps']), 'children': len(page['children'])}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, IndexError) as e:
        print(json.dumps({'status': 'error', 'message': str(e)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
