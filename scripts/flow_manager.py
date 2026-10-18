#!/usr/bin/env python3
"""Flow manager CLI: the one writer of flow files.

    python3 flow_manager.py <subcommand> --json '<one JSON object>'

The subcommand is the tool name with dashes (update-step-status). The JSON keys are the camelCase inputs of the
tool. One line of JSON goes to stdout: {"status": "ok", "files_written": [...]} or {"status": "error", "message": ...}.
Exit code 0 for ok, 1 for error.

Test hooks (environment): FLOW_MANAGER_NOW, FLOW_MANAGER_HOME, FLOW_MANAGER_PLUGIN_ROOT.
"""
import concurrent.futures
import contextlib
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid

try:
    import fcntl
except ImportError:  # Windows
    fcntl = None
    try:
        import msvcrt
    except ImportError:
        msvcrt = None

STEP_STATUSES = ['pending', 'in_progress', 'completed', 'skipped', 'awaiting_approval', 'blocked']
FLOW_STATUSES = ['running', 'completed', 'failed', 'paused']
FINDING_STATUSES = ['applied', 'rejected', 'deferred']
PATH_INPUTS = ['flowDir', 'templatePath', 'projectPath', 'parentFlowPath', 'childFlowPath']

# A step definition is copied into the flow, so the flow does not change when the template does.
EMBED_FIELDS = ['output', 'guidance', 'substeps', 'flow', 'memoryFileUsage', 'parameters', 'verifiers', 'maxFixes']
EXTRA_EMBED_FIELDS = ['improvementCategories', 'prioritization', 'workflow', 'successCriteria', 'searchModes', 'changeProposalFormat', 'captureTypes']

# The summary of a step's last run. Only the mod writes it (it is always allowed), and only a re-run of the same step reads it.
RERUN_TOPIC = 'rerun-summary'

# A flow lives in the folder of its status. A running or paused flow is in `active/`.
STATUS_FOLDER = {'completed': 'completed', 'failed': 'failed', 'running': 'active', 'paused': 'active'}


class ToolError(Exception):
    pass


def fail(message):
    raise ToolError(message)


def ok(*files):
    return {'status': 'ok', 'files_written': list(files)}


def truthy(x):
    """JavaScript truthiness: {} and [] are true, 0, '' and None are false."""
    return not (x is None or x is False or (not isinstance(x, bool) and isinstance(x, (int, float)) and x == 0) or x == '')


def nn(x, default):
    """JavaScript `x ?? default`."""
    return default if x is None else x


def slash(path):
    return path.replace('\\', '/')


# ── context the mod got from its ports ────────────────────────────────────

def now():
    fixed = os.environ.get('FLOW_MANAGER_NOW')
    if fixed:
        return fixed
    t = datetime.datetime.now(datetime.timezone.utc)
    return t.strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (t.microsecond // 1000)


def home():
    return slash(os.environ.get('FLOW_MANAGER_HOME') or os.path.expanduser('~'))


def plugin_root():
    fixed = os.environ.get('FLOW_MANAGER_PLUGIN_ROOT')
    return slash(fixed or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def new_id():
    return str(uuid.uuid4())


# ── files: JSON in, JSON out, atomic ──────────────────────────────────────

def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_json(path, data):
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix='.tmp-', suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


@contextlib.contextmanager
def locked(key):
    """One change at a time for each folder or file: a second process waits, then reads what the first one wrote.
    The lock files live under ~/.claude/zeremai/locks, so a flow folder holds no lock file and a move keeps nothing behind."""
    handle = None
    try:
        folder = os.path.join(home(), '.claude', 'zeremai', 'locks')
        os.makedirs(folder, exist_ok=True)
        handle = open(os.path.join(folder, hashlib.sha1(slash(key).encode('utf-8')).hexdigest() + '.lock'), 'a+')
        if fcntl:
            fcntl.flock(handle, fcntl.LOCK_EX)
        elif msvcrt:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
    except OSError:
        pass  # ponytail: no lock when the lock folder is not writable; the last write wins, as with the old script
    try:
        yield
    finally:
        if handle:
            handle.close()  # closing releases the lock


def read_flow(directory):
    path = directory + '/flow.json'
    if not os.path.exists(path):
        fail('flow.json not found in ' + directory)
    return read_json(path)


def read_log(directory):
    path = directory + '/log.json'
    if not os.path.exists(path):
        fail('log.json not found in ' + directory)
    return read_json(path)


def step_name(flow, step_id):
    for s in flow.get('steps') or []:
        if s.get('id') == step_id:
            return nn(s.get('name'), '')
    return ''


def union(old, added):
    return list(dict.fromkeys(list(old or []) + list(added)))


def js_text(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


# ── create-flow ───────────────────────────────────────────────────────────

def list_dir(path):
    """[(name, is_dir)] sorted by name; a folder that cannot be read is an error."""
    names = sorted(os.listdir(path), key=lambda n: (n.lower(), n))
    return [(n, os.path.isdir(os.path.join(path, n))) for n in names]


def registry(root, kind):
    """{id: path} for every `<folder>/<folder>.json` of the given type under root."""
    found = {}
    try:
        entries = list_dir(root)
    except OSError:
        return found
    for name, is_dir in entries:
        if not is_dir:
            continue
        path = '%s/%s/%s.json' % (root, name, name)
        if not os.path.exists(path):
            continue
        try:
            data = read_json(path)
        except (OSError, ValueError):
            continue  # not a definition
        if isinstance(data, dict) and data.get('type') == kind and truthy(data.get('id')):
            found[data['id']] = path
    return found


def embed(data):
    return {f: data[f] for f in EMBED_FIELDS + EXTRA_EMBED_FIELDS if f in data}


def verifier_path(folder, script):
    """The full path of a verifier file: a file of the step folder, never one outside it."""
    path = os.path.realpath(os.path.join(folder, script)) if isinstance(script, str) and script else ''
    if not path.startswith(os.path.realpath(folder) + os.sep):
        fail('A verifier must name a file inside its step folder, got: ' + js_text(script))
    return slash(path)


def create_flow(a):
    flow_dir = a['flowDir']
    if os.path.exists(flow_dir + '/flow.json'):
        fail('Flow already exists at ' + flow_dir)
    if not os.path.exists(a['templatePath']):
        fail('Template not found: ' + a['templatePath'])

    template = read_json(a['templatePath'])
    template_name = template.get('name')
    if template_name is None:
        template_name = a['templatePath'].split('/')[-1]
        if template_name.endswith('.json'):
            template_name = template_name[:-5]
    template_dir = a['templatePath'][:a['templatePath'].rindex('/')]
    step_files = registry(template_dir, 'step')

    steps = []
    for i, d in enumerate(nn(template.get('steps'), [])):
        ref = d.get('stepRef')
        if truthy(ref):
            if ref in step_files:
                definition = embed(read_json(step_files[ref]))
                step_folder = os.path.dirname(step_files[ref])
                for verifier in nn(definition.get('verifiers'), []):
                    verifier['script'] = verifier_path(step_folder, verifier.get('script') if isinstance(verifier, dict) else None)
            else:
                # No fallback: the id must be found.
                definition = nn(d.get('stepDefinition'), {})
                if not len(definition):
                    fail('Step definition UUID not found in template directory: ' + str(ref))
        else:
            definition = nn(d.get('stepDefinition'), {})  # no stepRef: an orchestrator step
        step = {'id': new_id(), 'number': i, 'name': nn(d.get('name'), 'Step %d' % i), 'status': 'pending', 'stepRef': ref if truthy(ref) else ''}
        if d.get('stepRefName') is not None:
            step['stepRefName'] = d['stepRefName']
        if d.get('approvalRequired') is not None:
            step['approvalRequired'] = d['approvalRequired']
        step['stepDefinition'] = definition
        for key in ['subFlowTrigger', 'loopBackTo', 'loopCondition', 'maxIterations', 'routes', 'onVerifierFail']:
            if d.get(key) is not None:
                step[key] = d[key]
        steps.append(step)

    # The framework steps, such as continuous improvement, go at the end of every flow.
    framework_root = plugin_root() + '/framework-steps'
    for name, is_dir in list_dir(framework_root):
        if not is_dir:
            continue
        path = '%s/%s/%s.json' % (framework_root, name, name)
        if not os.path.exists(path):
            continue
        data = read_json(path)
        if data.get('type') != 'framework-step':
            continue
        step = {'id': new_id(), 'number': len(steps), 'name': nn((data.get('metadata') or {}).get('title'), name), 'status': 'pending',
                'stepRef': nn(data.get('id'), ''), 'stepRefName': name}
        if data.get('approvalRequired') is not None:
            step['approvalRequired'] = data['approvalRequired']
        step['stepDefinition'] = embed(data)
        steps.append(step)

    parent_flow = None
    parent_path = a.get('parentFlowPath')
    if truthy(parent_path):
        if truthy(a.get('parentId')) and truthy(a.get('parentName')):
            parent_flow = {'id': a['parentId'], 'name': a['parentName'], 'flowPath': parent_path, 'returnToStep': nn(a.get('returnToStep'), '')}
        elif os.path.exists(parent_path + '/flow.json'):
            parent = read_json(parent_path + '/flow.json')
            parent_flow = {}
            for key in ['id', 'name']:
                if key in parent:  # a missing field stays out, as undefined does in JSON
                    parent_flow[key] = parent[key]
            parent_flow['flowPath'] = parent_path
            parent_flow['returnToStep'] = nn(a.get('returnToStep'), '')

    stamp = now()
    metadata = {'template': template_name, 'created': stamp, 'lastUpdated': stamp}
    if template.get('id') is not None:
        metadata['templateId'] = template['id']
    if template.get('category') is not None:
        metadata['templateCategory'] = template['category']
    metadata['projectPaths'] = [a['projectPath'] if truthy(a.get('projectPath')) else slash(os.getcwd())]
    metadata['flowPath'] = flow_dir

    first = steps[0] if steps else None
    flow = {
        'type': 'flow-instance', 'id': new_id(), 'name': a['name'] if truthy(a.get('name')) else template_name, 'metadata': metadata,
        'status': 'running', 'parameters': nn(a.get('params'), {}),
        'currentState': {'activeStep': {
            'id': first['id'] if first else '', 'name': first['name'] if first else '', 'actionSummary': 'Initializing flow',
            'totalSubsteps': len(nn(first['stepDefinition'].get('substeps'), [])) if first else 0, 'actionDetails': 'Flow created, ready to begin',
        }},
        'steps': steps,
    }
    if parent_flow:
        flow['subFlowState'] = {'parentFlow': parent_flow, 'childFlows': []}

    log = {
        'type': 'log-file',
        'metadata': {'flow': flow['id'], 'template': template_name, 'started': stamp, 'completed': None, 'parentFlowPath': nn(a.get('parentFlowPath'), None), 'subFlowPaths': []},
        'steps': {},
        'flowWideObservations': {'patternsDetected': [], 'userFeedbackSummary': [], 'efficiencyMetrics': {}, 'recommendationsForFuture': []},
        'executionMetrics': {'totalSteps': len(steps), 'stepsCompleted': 0, 'currentStep': first['id'] if first else ''},
    }

    write_json(flow_dir + '/flow.json', flow)
    write_json(flow_dir + '/memory/_cross-references.json', {'type': 'memory-cross-references', 'keyDecisions': [], 'filesModified': [], 'filesCreated': [], 'custom': {}})
    write_json(flow_dir + '/log.json', log)
    return ok('flow.json', 'memory/_cross-references.json', 'log.json')


# ── steps ─────────────────────────────────────────────────────────────────

def update_step_status(a):
    with locked(a['flowDir']):
        d = a['flowDir']
        if a['status'] not in STEP_STATUSES:
            fail('Invalid status "%s". Valid: %s' % (a['status'], ', '.join(STEP_STATUSES)))
        flow = read_flow(d)
        stamp = now()
        step = next((s for s in flow['steps'] if s.get('id') == a['stepId']), None)
        if step is None:
            fail('Step %s not found' % a['stepId'])

        # Approval gate: a step that needs approval cannot complete before the user approved it.
        if a['status'] == 'completed' and truthy(step.get('approvalRequired')) and step.get('approved') is not True:
            fail(
                'Step "%s" requires user approval before completion.\n\n' % step.get('name') +
                'This step has approvalRequired: true but has not been approved.\n'
                'Step approval is user-only. Call request_approval: the user approves with a click in a dialog.\n'
                'Once approved, retry: update_step_status with status completed')
        # A finished step stays finished. A flow goes back only through route_step: a click, a failed check or a counted retry.
        if step.get('status') == 'completed' and a['status'] != 'completed':
            fail('Step "%s" is finished. To go back, use route-step.' % step.get('name'))
        if step.get('status') == 'blocked' and a['status'] == 'completed':
            fail('Step "%s" is blocked: the user must act first. Do not complete it; the user presses Continue and the step runs again.' % step.get('name'))
        if a['status'] == 'in_progress':
            early = next((s for s in flow['steps'][:flow['steps'].index(step)] if s.get('status') not in ('completed', 'skipped')), None)
            if early:
                fail('Step "%s" cannot start: step "%s" is %s. Wait for it. If it is blocked, the user presses Continue.' % (step.get('name'), early.get('name'), early.get('status')))
        if a['status'] == 'blocked' and not str(a.get('reason') or '').strip():
            fail('A blocked step needs a reason: say in one sentence what the user must do (input "reason", and "command" if there is one).')
        step['status'] = a['status']
        # A blocked step carries what the user must do. Any other status clears it.
        step.pop('blocked', None)
        if a['status'] == 'blocked':
            step['blocked'] = {'reason': a['reason'].strip(), 'since': stamp}
            if str(a.get('command') or '').strip():
                step['blocked']['command'] = a['command'].strip()
        if a['status'] == 'in_progress' and step.get('startedAt') is None:
            step['startedAt'] = stamp
        elif a['status'] == 'completed':
            step['completedAt'] = stamp

        if a['status'] == 'completed' and os.path.exists(d + '/log.json'):
            log = read_log(d)
            if truthy(log.get('executionMetrics')):
                # Count from the steps, so a retry does not count twice.
                log['executionMetrics']['stepsCompleted'] = len([s for s in flow['steps'] if s.get('status') == 'completed'])
                write_json(d + '/log.json', log)
        flow['metadata']['lastUpdated'] = stamp
        write_json(d + '/flow.json', flow)
        return ok('flow.json')


def update_current_state(a):
    with locked(a['flowDir']):
        flow = read_flow(a['flowDir'])
        active = {'id': a['stepId'], 'name': a['stepName'], 'actionSummary': a['summary'], 'totalSubsteps': nn(a.get('totalSubsteps'), 0)}
        if a.get('details') is not None:
            active['actionDetails'] = a['details']
        if a.get('substepNumber') is not None and a.get('substepName') is not None:
            active['currentSubstep'] = {'number': a['substepNumber'], 'name': a['substepName']}
        flow['currentState'] = {'activeStep': active}
        flow['metadata']['lastUpdated'] = now()
        write_json(a['flowDir'] + '/flow.json', flow)
        return ok('flow.json')


def update_active_substep(a):
    with locked(a['flowDir']):
        flow = read_flow(a['flowDir'])
        active = (flow.get('currentState') or {}).get('activeStep')
        if not truthy(active):
            fail('The flow has no active step. Call update_current_state first.')
        active['currentSubstep'] = {'number': a['substepNumber'], 'name': a['substepName']}
        if a.get('summary') is not None:
            active['actionSummary'] = a['summary']
        flow['metadata']['lastUpdated'] = now()
        write_json(a['flowDir'] + '/flow.json', flow)
        return ok('flow.json')


def approve_step(a):
    """Only the mod calls this, after the user clicked Approve."""
    with locked(a['flowDir']):
        flow = read_flow(a['flowDir'])
        step = next((s for s in flow.get('steps') or [] if s.get('id') == a['stepId']), None)
        if step is None:
            fail('Step %s not found' % a['stepId'])
        if not truthy(step.get('approvalRequired')):
            fail('Step "%s" does not require approval' % step.get('name'))
        step['approved'] = True
        if truthy(flow.get('metadata')):
            flow['metadata']['lastUpdated'] = now()
        write_json(a['flowDir'] + '/flow.json', flow)
        return ok('flow.json')


# ── loops ─────────────────────────────────────────────────────────────────

# Automatic loops (a failed check, a retry of the agent) stop at maxIterations, or at this many when a step names none. A click has no limit.
DEFAULT_LOOPS = 3
LOOP_WAYS = ['click', 'retry', 'verifier']


def routes_of(step):
    """The Back buttons of a step: its `routes`, or `loopBackTo` as one route when the step needs approval."""
    routes = [r for r in nn(step.get('routes'), []) if isinstance(r, dict) and truthy(r.get('label')) and truthy(r.get('goTo'))]
    if not routes and truthy(step.get('loopBackTo')) and truthy(step.get('approvalRequired')):
        routes = [{'label': 'Back to %s' % step['loopBackTo'], 'goTo': step['loopBackTo']}]
    return routes


def find_target(steps, ref):
    """A step named by its name, its id or its number. Template files name steps by name."""
    ref = str(ref).strip()
    for s in steps:
        if str(s.get('name', '')).strip().lower() == ref.lower() or s.get('id') == ref or str(s.get('number')) == ref:
            return s
    return None


def route_step(a):
    """The flow goes back to an earlier step: the steps from there to this one are pending again. Their memory and log stay.
    by click: the user pressed a Back button (a label of routes_of). No limit, and the count of automatic loops starts again.
    by verifier: a check failed and the step names onVerifierFail. by retry: the agent goes back to loopBackTo.
    These two count against maxIterations. Only the mod runs click and verifier (the check of the agent's command)."""
    with locked(a['flowDir']):
        d = a['flowDir']
        flow = read_flow(d)
        steps = flow['steps']
        step = next((s for s in steps if s.get('id') == a['stepId']), None)
        if step is None:
            fail('Step %s not found' % a['stepId'])
        way = a['by']
        if way == 'click':
            route = next((r for r in routes_of(step) if r['label'] == a.get('label')), None)
            if route is None:
                fail('Step "%s" has no Back button "%s".' % (step.get('name'), a.get('label')))
            goto = route['goTo']
        else:
            goto = step.get('onVerifierFail') if way == 'verifier' else step.get('loopBackTo')
            if not truthy(goto):
                fail('Step "%s" has no %s to go back to.' % (step.get('name'), 'onVerifierFail' if way == 'verifier' else 'loopBackTo'))
            used, cap = nn(step.get('loopsUsed'), 0), nn(step.get('maxIterations'), DEFAULT_LOOPS)
            if used >= cap:
                fail('Step "%s" went back %d times, the most it can. Mark it blocked and tell the user.' % (step.get('name'), cap))
        target = find_target(steps, goto)
        here = steps.index(step)
        if target is None or steps.index(target) >= here:
            fail('"%s" is not an earlier step than "%s".' % (goto, step.get('name')))
        stamp = now()
        for s in steps[steps.index(target):here + 1]:
            s['status'] = 'pending'
            for key in ['approved', 'startedAt', 'completedAt', 'blocked', 'loopsUsed']:
                s.pop(key, None)
        if way != 'click':
            step['loopsUsed'] = used + 1
        flow['currentState'] = {'activeStep': {
            'id': target['id'], 'name': target['name'], 'actionSummary': 'Going back to step "%s"' % target['name'],
            'totalSubsteps': len(nn(target['stepDefinition'].get('substeps'), []))}}
        flow['metadata']['lastUpdated'] = stamp
        write_json(d + '/flow.json', flow)
        if os.path.exists(d + '/log.json'):
            log = read_log(d)
            if truthy(log.get('executionMetrics')):
                log['executionMetrics']['stepsCompleted'] = len([s for s in steps if s.get('status') == 'completed'])
                log['executionMetrics']['currentStep'] = target['id']
                write_json(d + '/log.json', log)
        return {**ok('flow.json', 'log.json'), 'target': {'id': target['id'], 'name': target['name'], 'number': target['number']}, 'loopsUsed': nn(step.get('loopsUsed'), 0)}


def reset_loops(a):
    """The user asked for changes: the step's count of automatic loops starts again. Only the mod calls this."""
    with locked(a['flowDir']):
        flow = read_flow(a['flowDir'])
        step = next((s for s in flow['steps'] if s.get('id') == a['stepId']), None)
        if step is None:
            fail('Step %s not found' % a['stepId'])
        step.pop('loopsUsed', None)
        flow['metadata']['lastUpdated'] = now()
        write_json(a['flowDir'] + '/flow.json', flow)
        return ok('flow.json')


# ── memory────────────────────────────────────────────────────────────────

def validate_topic_access(directory, step_id, topic, access):
    """A step can read and write only the topics its definition lists. An empty or old-format list means no limit."""
    if topic == '_cross-references' or (topic == RERUN_TOPIC and access == 'writeTo'):
        return
    flow = read_flow(directory)
    step = next((s for s in flow['steps'] if s.get('id') == step_id), None)
    allowed = (((step or {}).get('stepDefinition') or {}).get('memoryFileUsage') or {}).get(access)
    if not isinstance(allowed, list) or len(allowed) == 0:
        return
    if topic + '.json' in allowed or topic in allowed:
        return
    label = 'write to' if access == 'writeTo' else 'read from'
    fail('Step "%s" is not allowed to %s topic "%s.json". Allowed %s topics: %s' % (
        step_name(flow, step_id), label, topic, access, json.dumps(allowed, ensure_ascii=False, separators=(',', ':'))))


def memory_dir(directory):
    if not os.path.exists(directory + '/memory'):
        fail('memory/ directory not found in ' + directory)
    return directory + '/memory'


def add_memory_entry(a):
    with locked(a['flowDir']):
        memory = memory_dir(a['flowDir'])
        validate_topic_access(a['flowDir'], a['stepId'], a['topic'], 'writeTo')
        info, decisions, files = nn(a.get('info'), {}), nn(a.get('decisions'), []), nn(a.get('files'), [])
        stamp = now()
        topic_path = '%s/%s.json' % (memory, a['topic'])
        if os.path.exists(topic_path):
            topic = read_json(topic_path)
        else:
            topic = {'type': 'memory-topic-file', 'topic': a['topic'], 'lastUpdated': stamp, 'entries': {}}
        existing = topic['entries'].get(a['stepId'])
        if existing is not None:
            existing['informationProduced'] = {**(existing.get('informationProduced') or {}), **info}
            existing['decisionsMade'] = union(existing.get('decisionsMade'), decisions)
            existing['filesModifiedCreated'] = union(existing.get('filesModifiedCreated'), files)
            existing['updatedAt'] = stamp
        else:
            topic['entries'][a['stepId']] = {
                'stepName': step_name(read_flow(a['flowDir']), a['stepId']),
                'informationProduced': info, 'decisionsMade': decisions, 'filesModifiedCreated': files, 'updatedAt': stamp,
            }
        topic['lastUpdated'] = stamp
        write_json(topic_path, topic)

        # The cross-reference file gathers the decisions and files of every topic.
        xref_path = memory + '/_cross-references.json'
        if os.path.exists(xref_path):
            xref = read_json(xref_path)
        else:
            xref = {'type': 'memory-cross-references', 'keyDecisions': [], 'filesModified': [], 'filesCreated': [], 'custom': {}}
        xref['keyDecisions'] = union(xref.get('keyDecisions'), decisions)
        xref['filesModified'] = union(xref.get('filesModified'), files)
        write_json(xref_path, xref)
        return ok('memory/%s.json' % a['topic'], 'memory/_cross-references.json')


def read_memory_topic(a):
    memory = memory_dir(a['flowDir'])
    validate_topic_access(a['flowDir'], a['stepId'], a['topic'], 'readFrom')
    path = '%s/%s.json' % (memory, a['topic'])
    return {'status': 'ok', 'topic': a['topic'], 'data': read_json(path) if os.path.exists(path) else None}


def get_step_brief(a):
    """The prompt of a step subagent, as one text: the step, the flow parameters, the content of the memory topics the
    step reads, and on a re-run its summary and the corrections. It only reads."""
    d = a['flowDir']
    flow = read_flow(d)
    step = next((s for s in flow['steps'] if s.get('id') == a['stepId']), None)
    if step is None:
        fail('Step %s not found' % a['stepId'])
    definition = step.get('stepDefinition')
    if not isinstance(definition, dict) or not definition:
        fail('Empty stepDefinition: this is a sub-flow step. The orchestrator drives it, so it has no brief.')

    def block(title, value):
        return '## %s\n%s\n' % (title, value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2))

    corrections = nn(a.get('corrections'), '').strip()
    parts = ['# Step %s: %s\nFlow directory: %s\nStep ID: %s\n' % (nn(step.get('number'), ''), nn(step.get('name'), ''), d, a['stepId']),
             block('Parameters', nn(flow.get('parameters'), {})), block('Step definition', definition)]
    topics = nn((nn(definition.get('memoryFileUsage'), {})).get('readFrom'), [])
    memory = ['### %s\n%s' % (t, json.dumps(read_json('%s/memory/%s.json' % (d, t)), ensure_ascii=False, indent=2)
                              if os.path.exists('%s/memory/%s.json' % (d, t)) else '(no entries yet)')
              for t in (name[:-5] if name.endswith('.json') else name for name in topics)]
    parts.append(block('Memory', '\n\n'.join(memory) if memory else '(this step reads no memory topic)'))
    if corrections:
        path = '%s/memory/%s.json' % (d, RERUN_TOPIC)
        entry = ((read_json(path).get('entries') or {}).get(a['stepId']) or {}) if os.path.exists(path) else {}
        earlier = (entry.get('informationProduced') or {}).get('summary')
        if earlier:
            parts.append(block('Earlier summary', earlier))
        parts.append(block('User corrections', corrections))
    return {'status': 'ok', 'text': '\n'.join(parts)}


# ── verifiers ─────────────────────────────────────────────────────────────

# The mod runs the verifiers inside a hook, which has about 10 seconds. So no script can run longer than this.
VERIFIER_MAX_SEC = 8


def read_answer(text):
    """The checks of a verifier answer: the last line of stdout, {"status": "pass"|"fail", "checks": [{name, passed, message?}]}.
    None if it is not that shape, or if the status does not agree with the checks."""
    try:
        answer = json.loads(text.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return None
    if not isinstance(answer, dict) or answer.get('status') not in ('pass', 'fail') or not isinstance(answer.get('checks'), list):
        return None
    checks = []
    for c in answer['checks']:
        if not (isinstance(c, dict) and isinstance(c.get('name'), str) and isinstance(c.get('passed'), bool) and isinstance(c.get('message', ''), str)):
            return None
        checks.append({'name': c['name'], 'passed': c['passed'], 'message': c.get('message', '')[:500]})
    return checks if (answer['status'] == 'pass') == all(c['passed'] for c in checks) else None


def run_verifier(verifier, flow_dir, step_id, cwd):
    """The checks of one verifier. It never raises: a crash, a timeout or a wrong answer is one failed check."""
    script = verifier.get('script') if isinstance(verifier, dict) else None
    name = os.path.basename(script) if isinstance(script, str) else 'verifier'

    def failed(text):
        return [{'name': name, 'passed': False, 'message': text}]
    if not isinstance(script, str) or not os.path.isfile(script):
        return failed('verifier file not found')
    try:
        limit = min(max(float(nn(verifier.get('timeoutSec'), 5)), 1), VERIFIER_MAX_SEC)
    except (TypeError, ValueError):
        limit = 5
    try:
        done = subprocess.run([sys.executable, script, flow_dir, step_id], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=limit, cwd=cwd)
    except subprocess.TimeoutExpired:
        return failed('verifier timed out after %gs' % limit)
    except Exception as error:
        return failed('verifier could not start: ' + (str(error) or error.__class__.__name__))
    if done.returncode != 0:
        return failed('verifier crashed: ' + ((done.stderr.strip().splitlines() or ['no message'])[-1])[:300])
    checks = read_answer(done.stdout)
    return checks if checks is not None else failed('verifier answer is not valid')


def run_verifiers(a):
    """Run the verifiers of a step. The answer is always status ok: result is pass or fail, with the checks of all verifiers.
    A step with no verifiers passes with no checks. It only reads."""
    d = a['flowDir']
    flow = read_flow(d)
    step = next((s for s in flow['steps'] if s.get('id') == a['stepId']), None)
    if step is None:
        fail('Step %s not found' % a['stepId'])
    verifiers = nn((step.get('stepDefinition') or {}).get('verifiers'), [])
    paths = nn((flow.get('metadata') or {}).get('projectPaths'), [])
    cwd = paths[0] if paths and os.path.isdir(paths[0]) else None
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(verifiers))) as pool:
        groups = list(pool.map(lambda v: run_verifier(v, d, a['stepId'], cwd), verifiers))
    checks = [c for g in groups for c in g]
    return {'status': 'ok', 'result': 'pass' if all(c['passed'] for c in checks) else 'fail', 'checks': checks}


# ── log ───────────────────────────────────────────────────────────────────

LOG_LISTS = [('actions', 'actionsTaken'), ('reasoning', 'agentReasoning'), ('filesModified', 'filesModified'),
             ('problems', 'problemsEncountered'), ('decisions', 'decisionsMade'), ('performanceNotes', 'performanceNotes')]
# A repeated call must not add the same decision or file twice. Actions and notes can repeat on purpose.
DEDUPED = ['decisionsMade', 'filesModified']


def touch(entry, stamp):
    """The step's timestamp is a string in old logs and { startedAt, updatedAt } now."""
    old = entry.get('timestamp')
    if isinstance(old, dict):
        entry['timestamp'] = {**old, 'updatedAt': stamp}
    else:
        entry['timestamp'] = ({'startedAt': old} if old is not None else {}) | {'updatedAt': stamp}


def add_log_entry(a):
    with locked(a['flowDir']):
        log = read_log(a['flowDir'])
        stamp = now()
        entry = log['steps'].get(a['stepId'])
        if entry is not None:
            for arg, field in LOG_LISTS:
                items = a.get(arg)
                if items:
                    entry[field] = union(entry.get(field), items) if field in DEDUPED else list(nn(entry.get(field), [])) + list(items)
            touch(entry, stamp)
        else:
            created = {'timestamp': {'startedAt': stamp}}
            for arg, field in LOG_LISTS:
                items = a.get(arg)
                # The actions list is left out when empty; the other lists keep an empty list that the agent sent.
                if (items if arg == 'actions' else items is not None):
                    created[field] = items
            log['steps'][a['stepId']] = created
        if truthy(log.get('executionMetrics')):
            log['executionMetrics']['currentStep'] = a['stepId']
        write_json(a['flowDir'] + '/log.json', log)
        return ok('log.json')


def log_interaction(a):
    with locked(a['flowDir']):
        log = read_log(a['flowDir'])
        stamp = now()
        interaction = {'request': a['request'], 'reason': a['reason'], 'agentResponse': a['response'], 'timestamp': stamp}
        if truthy(a.get('forImprovement')):
            interaction['forImprovementStep'] = True
        if a.get('potentialImprovement') is not None:
            interaction['potentialImprovement'] = a['potentialImprovement']
        entry = log['steps'].get(a['stepId'])
        if entry is not None:
            entry['userInteractions'] = list(nn(entry.get('userInteractions'), [])) + [interaction]
            if isinstance(entry.get('timestamp'), dict):
                entry['timestamp'] = {**entry['timestamp'], 'updatedAt': stamp}
        else:
            log['steps'][a['stepId']] = {'timestamp': {'startedAt': stamp}, 'userInteractions': [interaction]}
        write_json(a['flowDir'] + '/log.json', log)
        return ok('log.json')


def update_log_observations(a):
    with locked(a['flowDir']):
        log = read_log(a['flowDir'])
        wide = log.setdefault('flowWideObservations', {})
        for key, items in [('patternsDetected', a.get('patterns')), ('userFeedbackSummary', a.get('feedback')), ('recommendationsForFuture', a.get('recommendations'))]:
            if items:
                wide[key] = list(nn(wide.get(key), [])) + list(items)
        if a.get('metrics'):
            wide['efficiencyMetrics'] = {**nn(wide.get('efficiencyMetrics'), {}), **a['metrics']}
        write_json(a['flowDir'] + '/log.json', log)
        return ok('log.json')


# ── flow status and sub-flows ─────────────────────────────────────────────

def notify_parent(child, parent_ref, summary):
    with locked(parent_ref['flowPath']):
        parent_path = parent_ref['flowPath'] + '/flow.json'
        if not os.path.exists(parent_path):
            return
        parent = read_json(parent_path)
        sub = parent.get('subFlowState')
        entry = next((c for c in ((sub or {}).get('childFlows') or []) if c.get('id') == child.get('id')), None)
        if truthy(sub):
            if entry is not None:
                entry['status'] = 'completed'
            parent['metadata']['lastUpdated'] = now()
            write_json(parent_path, parent)
        # The summary goes into the parent's memory, under the step that started the child.
        topic_path = parent_ref['flowPath'] + '/memory/sub-flows.json'
        if not os.path.exists(parent_ref['flowPath'] + '/memory') or entry is None or not truthy(entry.get('spawnedAtStep')):
            return
        stamp = now()
        if os.path.exists(topic_path):
            topic = read_json(topic_path)
        else:
            topic = {'type': 'memory-topic-file', 'topic': 'sub-flows', 'lastUpdated': stamp, 'entries': {}}
        spawn = entry['spawnedAtStep']
        key = 'childSummary_%s' % child.get('id')
        if spawn in topic['entries']:
            topic['entries'][spawn]['informationProduced'] = {**(topic['entries'][spawn].get('informationProduced') or {}), key: summary}
            topic['entries'][spawn]['updatedAt'] = stamp
        else:
            topic['entries'][spawn] = {'stepName': step_name(parent, spawn), 'informationProduced': {key: summary}, 'decisionsMade': [], 'filesModifiedCreated': [], 'updatedAt': stamp}
        topic['lastUpdated'] = stamp
        write_json(topic_path, topic)


def update_flow_status(a):
    d = a['flowDir']
    with locked(d):
        if a['status'] not in FLOW_STATUSES:
            fail('Invalid status "%s". Valid: %s' % (a['status'], ', '.join(FLOW_STATUSES)))
        flow = read_flow(d)

        # A finished sub-flow tells its parent what it did.
        parent_ref = (flow.get('subFlowState') or {}).get('parentFlow')
        if a['status'] == 'completed' and truthy(parent_ref):
            if not truthy(a.get('summary')):
                fail(
                    "This flow is a sub-flow of '%s' (path: %s). " % (parent_ref.get('name'), parent_ref.get('flowPath')) +
                    'When completing a sub-flow, you must provide a summary describing what was accomplished. '
                    'The parent flow needs this summary to continue.\n\n'
                    'Example: summary "Implemented feature X, created PR #123, all tests passing"')
            # Best effort: a parent that cannot be told must not stop the child from completing.
            try:
                notify_parent(flow, parent_ref, a['summary'])
            except Exception:
                pass  # parent not told

        flow['status'] = a['status']
        flow['metadata']['lastUpdated'] = now()
        if a['status'] == 'completed':
            flow['metadata']['completed'] = flow['metadata']['lastUpdated']  # the completion time: no step has to record it
        write_json(d + '/flow.json', flow)

        target = STATUS_FOLDER.get(a['status'])
        parts = slash(d).rstrip('/').split('/')
        name = parts.pop()
        current = parts[-1] if parts else None
        if not target or current == target:
            return ok('flow.json')

        target_parent = '/'.join(parts[:-1]) + '/' + target
        new_dir = target_parent + '/' + name
        if os.path.exists(new_dir):
            fail('Cannot relocate: target directory already exists: ' + new_dir)
        try:
            os.makedirs(target_parent, exist_ok=True)
            shutil.move(d, new_dir)
        except Exception as error:
            fail('Cannot relocate: %s' % (error.strerror if isinstance(error, OSError) and error.strerror else error))
        moved = read_json(new_dir + '/flow.json')
        moved['metadata']['flowPath'] = new_dir
        write_json(new_dir + '/flow.json', moved)
        return {**ok('flow.json'), 'relocated_to': new_dir}


def check_flow_status(value):
    if value not in FLOW_STATUSES:
        fail('Invalid status "%s". Valid: %s' % (value, ', '.join(FLOW_STATUSES)))


def register_child_flow(a):
    with locked(a['flowDir']):
        check_flow_status(a['childStatus'])
        flow = read_flow(a['flowDir'])
        child = {'id': a['childId'], 'name': a['childName'], 'status': a['childStatus'], 'spawnedAtStep': a['spawnedAtStep'], 'syncPoint': a['syncPoint'], 'flowPath': a['childFlowPath']}
        if not truthy(flow.get('subFlowState')):
            flow['subFlowState'] = {'parentFlow': None, 'childFlows': [child]}
        else:
            children = flow['subFlowState'].setdefault('childFlows', [])
            at = next((i for i, c in enumerate(children) if c.get('id') == child['id']), -1)
            if at == -1:
                children.append(child)
            else:
                children[at] = child
        flow['metadata']['lastUpdated'] = now()
        write_json(a['flowDir'] + '/flow.json', flow)
        return ok('flow.json')


def update_child_status(a):
    with locked(a['flowDir']):
        check_flow_status(a['childStatus'])
        flow = read_flow(a['flowDir'])
        if not truthy(flow.get('subFlowState')):
            fail('No subFlowState found on this flow')
        child = next((c for c in (flow['subFlowState'].get('childFlows') or []) if c.get('id') == a['childId']), None)
        if child is None:
            fail('Child flow %s not found in subFlowState.childFlows' % a['childId'])
        child['status'] = a['childStatus']
        flow['metadata']['lastUpdated'] = now()
        write_json(a['flowDir'] + '/flow.json', flow)
        return ok('flow.json')


# ── improvement findings ──────────────────────────────────────────────────

def findings_dir():
    return home() + '/.claude/zeremai/improvement-findings'


def list_names(path):
    try:
        return list_dir(path)
    except OSError:
        return []


def write_finding(a):
    flow = read_flow(a['flowDir'])
    meta = flow['metadata']
    # A template installed before templateId existed groups under its name.
    template_key = meta.get('templateId') if truthy(meta.get('templateId')) else meta.get('template')
    path = '%s/%s/%s.json' % (findings_dir(), template_key, flow['id'])
    with locked(path):
        if os.path.exists(path):
            data = read_json(path)
        else:
            data = {'type': 'improvement-findings-file', 'templateId': template_key, 'template': meta.get('template'),
                    'flowId': flow['id'], 'flowName': flow.get('name'), 'findings': []}
        data['findings'].append({
            'id': new_id(), 'flowId': flow['id'], 'flowName': flow.get('name'), 'template': meta.get('template'),
            'createdAt': now(), 'category': a['category'], 'title': a['title'], 'what': a['what'], 'why': a['why'], 'impact': a['impact'],
            'scope': nn(a.get('scope'), []), 'status': 'open',
        })
        write_json(path, data)
        return ok(path)


def list_findings(a):
    root = findings_dir()
    folders = [(a['templateId'], True)] if truthy(a.get('templateId')) else [f for f in list_names(root) if f[1]]
    found = []
    for folder, _ in folders:
        for file, _ in [f for f in list_names('%s/%s' % (root, folder)) if f[0].endswith('.json')]:
            data = read_json('%s/%s/%s' % (root, folder, file))
            for finding in nn(data.get('findings'), []):
                if not truthy(a.get('status')) or finding.get('status') == a['status']:
                    found.append(finding)
    return {'status': 'ok', 'findings': found}


def update_finding_status(a):
    # A flow id is unique everywhere, so the template folder need not be given: find the folder that holds this flow's file.
    root = findings_dir()
    path = None
    for folder, is_dir in list_names(root):
        if not is_dir:
            continue
        candidate = '%s/%s/%s.json' % (root, folder, a['flowId'])
        if os.path.exists(candidate):
            path = candidate
            break
    if path is None:
        fail('No findings file for flow %s' % a['flowId'])
    with locked(path):
        data = read_json(path)
        finding = next((f for f in nn(data.get('findings'), []) if f.get('id') == a['findingId']), None)
        if finding is None:
            fail('Finding %s not found in %s' % (a['findingId'], path))
        finding['status'] = a['status']
        finding['resolution'] = {'resolvedAt': now(), 'notes': nn(a.get('notes'), None), 'filesModified': nn(a.get('filesModified'), [])}
        write_json(path, data)
        return ok(path)


# ── flavors ───────────────────────────────────────────────────────────────
# One folder, ~/.claude/zeremai/flavors: <id>.json holds a flavor, index.json holds one short line for each. The user's own
# flavors are active. A flavor the agent proposes (add, update or remove one) is pending until the user accepts it on the page.

FLAVOR_ID = re.compile(r'^[\w-]{1,64}$')


def flavors_dir():
    return home() + '/.claude/zeremai/flavors'


def flavor_line(f):
    line = {'id': f['id'], 'topic': f['topic'], 'description': ' '.join(f['text'].split())[:120], 'status': f['status'], 'file': f['id'] + '.json', 'updatedAt': f['updatedAt']}
    if f.get('change'):
        line.update(change=f['change'], targetId=f['targetId'])
    return line


def read_flavor_index():
    path = flavors_dir() + '/index.json'
    return read_json(path) if os.path.exists(path) else {'type': 'flavors-index', 'flavors': []}


def get_flavor(flavor_id):
    if not isinstance(flavor_id, str) or not FLAVOR_ID.match(flavor_id):
        fail('Bad flavor id.')
    path = '%s/%s.json' % (flavors_dir(), flavor_id)
    if not os.path.exists(path):
        fail('Flavor %s not found' % flavor_id)
    return read_json(path)


def put_flavor(flavor):
    """The caller holds the lock. The file first, then its line: a crash in between leaves a file the index does not list, never a line with no file."""
    write_json('%s/%s.json' % (flavors_dir(), flavor['id']), flavor)
    index = read_flavor_index()
    index['flavors'] = [l for l in index['flavors'] if l['id'] != flavor['id']] + [flavor_line(flavor)]
    write_json(flavors_dir() + '/index.json', index)


def drop_flavor(flavor_id):
    index = read_flavor_index()
    index['flavors'] = [l for l in index['flavors'] if l['id'] != flavor_id]
    write_json(flavors_dir() + '/index.json', index)
    with contextlib.suppress(FileNotFoundError):
        os.remove('%s/%s.json' % (flavors_dir(), flavor_id))


def flavor_text(a, key):
    value = a.get(key)
    if not isinstance(value, str) or not value.strip():
        fail('%s must be a text that is not empty.' % key)
    return value.strip()


def list_flavors(a):
    if truthy(a.get('id')):
        return {'status': 'ok', 'flavor': get_flavor(a['id'])}
    return {'status': 'ok', 'flavors': [l for l in read_flavor_index()['flavors'] if not truthy(a.get('status')) or l['status'] == a['status']]}


def set_flavor(a):
    """The user's own flavor, from the page: a new one, or a new text for the one with this id. The agent cannot call it."""
    topic, text = flavor_text(a, 'topic'), flavor_text(a, 'text')
    with locked(flavors_dir()):
        flavor = get_flavor(a['id']) if truthy(a.get('id')) else {'id': new_id(), 'source': 'user', 'status': 'active'}
        flavor.update(topic=topic, text=text, updatedAt=now())
        put_flavor(flavor)
        return ok(flavor['id'] + '.json', 'index.json')


def flavor_quote(a):
    """The few words of the user that led to a proposal. Empty is left out; a long one is cut."""
    quote = ' '.join(str(nn(a.get('evidence'), '')).split())
    return {'evidence': quote[:200]} if quote else {}


def propose_flavor(a, change, topic, text, target_id=None):
    meta = read_flow(a['flowDir'])
    with locked(flavors_dir()):
        flavor = {'id': new_id(), 'topic': topic, 'text': text, 'source': 'learned', 'status': 'pending', 'change': change,
                  'fromFlow': nn(meta.get('name'), None), 'updatedAt': now(), **flavor_quote(a)}
        flavor['targetId'] = target_id
        put_flavor(flavor)
        return ok(flavor['id'] + '.json', 'index.json')


def save_flavor(a):
    """The agent proposes a new flavor, or a new text for the one named by targetId. Nothing changes for a step until the user accepts."""
    topic, text = flavor_text(a, 'topic'), flavor_text(a, 'text')
    if truthy(a.get('targetId')):
        if get_flavor(a['targetId']).get('status') != 'active':
            fail('Only an active flavor can be changed.')
        return propose_flavor(a, 'update', topic, text, a['targetId'])
    return propose_flavor(a, 'add', topic, text)


def delete_flavor(a):
    """The agent proposes to forget an active flavor. It stays until the user accepts."""
    target = get_flavor(a['targetId'])
    if target.get('status') != 'active':
        fail('Only an active flavor can be removed.')
    return propose_flavor(a, 'remove', target['topic'], target['text'], a['targetId'])


def apply_proposal(pending):
    """Make one pending proposal true. The caller holds the lock. False when the flavor it changes is gone (nothing to apply)."""
    change, target_id = pending.get('change'), pending.get('targetId')
    if change == 'add':
        pending['status'] = 'active'
        for key in ('change', 'targetId', 'evidence'):
            pending.pop(key, None)
        pending['updatedAt'] = now()
        put_flavor(pending)
        return True
    try:
        target = get_flavor(target_id)
    except ToolError:
        return False
    if change == 'update':
        target.update(topic=pending['topic'], text=pending['text'], updatedAt=now())
        put_flavor(target)
    else:
        drop_flavor(target_id)
    drop_flavor(pending['id'])
    return True


def accept_flavor(a):
    with locked(flavors_dir()):
        pending = get_flavor(a['id'])
        if pending.get('status') != 'pending':
            fail('Flavor %s is not waiting.' % a['id'])
        if not apply_proposal(pending):
            fail('The flavor it changes is gone. Remove this one.')
        return ok('index.json')


def accept_all_flavors(a):
    """Accept every waiting proposal, oldest first, under one lock. A proposal whose flavor is gone is dropped and counted as skipped."""
    with locked(flavors_dir()):
        waiting = sorted((l for l in read_flavor_index()['flavors'] if l['status'] == 'pending'), key=lambda l: l['updatedAt'])
        accepted = skipped = 0
        for line in waiting:
            try:
                pending = get_flavor(line['id'])
            except ToolError:
                continue
            if apply_proposal(pending):
                accepted += 1
            else:
                drop_flavor(pending['id'])
                skipped += 1
        return {**ok('index.json'), 'accepted': accepted, 'skipped': skipped}


def remove_flavor(a):
    """Delete one flavor for good: the user's delete, or the user's no to a pending one."""
    get_flavor(a['id'])
    with locked(flavors_dir()):
        drop_flavor(a['id'])
        return ok('index.json')


# ── the CLI ───────────────────────────────────────────────────────────────

# tool name → (required inputs, enum inputs, function). The names and inputs are those of the tool schemas in tools.ts.
TOOLS = {
    'create_flow': (['flowDir', 'templatePath'], {}, create_flow),
    'update_step_status': (['flowDir', 'stepId', 'status'], {'status': STEP_STATUSES}, update_step_status),
    'update_current_state': (['flowDir', 'stepId', 'stepName', 'summary'], {}, update_current_state),
    'update_active_substep': (['flowDir', 'substepNumber', 'substepName'], {}, update_active_substep),
    'add_memory_entry': (['flowDir', 'stepId', 'topic'], {}, add_memory_entry),
    'read_memory_topic': (['flowDir', 'stepId', 'topic'], {}, read_memory_topic),
    'get_step_brief': (['flowDir', 'stepId'], {}, get_step_brief),
    'run_verifiers': (['flowDir', 'stepId'], {}, run_verifiers),
    'add_log_entry': (['flowDir', 'stepId'], {}, add_log_entry),
    'log_interaction': (['flowDir', 'stepId', 'request', 'reason', 'response'], {}, log_interaction),
    'update_flow_status': (['flowDir', 'status'], {'status': FLOW_STATUSES}, update_flow_status),
    'register_child_flow': (['flowDir', 'childId', 'childName', 'childStatus', 'spawnedAtStep', 'syncPoint', 'childFlowPath'], {'childStatus': FLOW_STATUSES}, register_child_flow),
    'update_child_status': (['flowDir', 'childId', 'childStatus'], {'childStatus': FLOW_STATUSES}, update_child_status),
    'update_log_observations': (['flowDir'], {}, update_log_observations),
    'write_finding': (['flowDir', 'category', 'title', 'what', 'why', 'impact'], {}, write_finding),
    'list_findings': ([], {'status': ['open'] + FINDING_STATUSES}, list_findings),
    'update_finding_status': (['flowId', 'findingId', 'status'], {'status': FINDING_STATUSES}, update_finding_status),
    'list_flavors': ([], {'status': ['active', 'pending']}, list_flavors),
    'save_flavor': (['flowDir', 'topic', 'text'], {}, save_flavor),
    'delete_flavor': (['flowDir', 'targetId'], {}, delete_flavor),
    'set_flavor': (['topic', 'text'], {}, set_flavor),
    'accept_flavor': (['id'], {}, accept_flavor),
    'accept_all_flavors': ([], {}, accept_all_flavors),
    'remove_flavor': (['id'], {}, remove_flavor),
    'approve_step': (['flowDir', 'stepId'], {}, approve_step),
    'route_step': (['flowDir', 'stepId', 'by'], {'by': LOOP_WAYS}, route_step),
    'reset_loops': (['flowDir', 'stepId'], {}, reset_loops),
}


def run(subcommand, raw):
    name = subcommand.replace('-', '_')
    if name not in TOOLS:
        return {'status': 'error', 'message': 'Unknown flow tool: %s' % subcommand}
    try:
        args = json.loads(raw)
    except ValueError:
        return {'status': 'error', 'message': 'The input after --json must be one JSON object.'}
    if not isinstance(args, dict):
        return {'status': 'error', 'message': 'The input after --json must be one JSON object.'}
    required, enums, function = TOOLS[name]
    args = {k: (slash(v) if k in PATH_INPUTS and isinstance(v, str) else v) for k, v in args.items()}
    try:
        missing = [k for k in required if args.get(k) is None]
        if missing:
            fail('Missing input for %s: %s' % (name, ', '.join(missing)))
        for key, allowed in enums.items():
            if key in args and args[key] not in allowed:
                fail('Invalid %s "%s". Valid: %s' % (key, js_text(args[key]), ', '.join(allowed)))
        return function(args)
    except ToolError as error:
        return {'status': 'error', 'message': str(error)}
    except Exception as error:  # a fault of the disk or a file that is not what it should be
        return {'status': 'error', 'message': str(error) or error.__class__.__name__}


def main(argv):
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not argv:
        result = {'status': 'error', 'message': 'Usage: flow_manager.py <subcommand> --json \'<one JSON object>\''}
    else:
        raw = '{}'
        if '--json' in argv[1:]:
            at = argv.index('--json', 1)
            if at + 1 >= len(argv):
                raw = ''
            else:
                raw = sys.stdin.read() if argv[at + 1] == '-' else argv[at + 1]
        result = run(argv[0], raw)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('status') == 'ok' else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
