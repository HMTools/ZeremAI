#!/usr/bin/env python3
"""Flow manager CLI: the one writer of flow files.

    python3 flow_manager.py <subcommand> --json '<one JSON object>'

The subcommand is the tool name with dashes (update-step-status). The JSON keys are the camelCase inputs of the
tool. One line of JSON goes to stdout: {"status": "ok", "files_written": [...]} or {"status": "error", "message": ...}.
Exit code 0 for ok, 1 for error.

Test hooks (environment): FLOW_MANAGER_NOW, FLOW_MANAGER_HOME, FLOW_MANAGER_PLUGIN_ROOT.
"""
import contextlib
import datetime
import hashlib
import json
import os
import shutil
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

STEP_STATUSES = ['pending', 'in_progress', 'completed', 'skipped', 'awaiting_approval']
FLOW_STATUSES = ['running', 'completed', 'failed', 'paused']
FINDING_STATUSES = ['applied', 'rejected', 'deferred']
PATH_INPUTS = ['flowDir', 'templatePath', 'projectPath', 'parentFlowPath', 'childFlowPath']

# A step definition is copied into the flow, so the flow does not change when the template does.
EMBED_FIELDS = ['output', 'guidance', 'substeps', 'flow', 'memoryFileUsage', 'parameters']
EXTRA_EMBED_FIELDS = ['improvementCategories', 'prioritization', 'workflow', 'successCriteria', 'searchModes', 'changeProposalFormat', 'captureTypes']

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
        for key in ['subFlowTrigger', 'loopBackTo', 'loopCondition', 'maxIterations']:
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
        step['status'] = a['status']
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


# ── memory ────────────────────────────────────────────────────────────────

def validate_topic_access(directory, step_id, topic, access):
    """A step can read and write only the topics its definition lists. An empty or old-format list means no limit."""
    if topic == '_cross-references':
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


# ── the CLI ───────────────────────────────────────────────────────────────

# tool name → (required inputs, enum inputs, function). The names and inputs are those of the tool schemas in tools.ts.
TOOLS = {
    'create_flow': (['flowDir', 'templatePath'], {}, create_flow),
    'update_step_status': (['flowDir', 'stepId', 'status'], {'status': STEP_STATUSES}, update_step_status),
    'update_current_state': (['flowDir', 'stepId', 'stepName', 'summary'], {}, update_current_state),
    'update_active_substep': (['flowDir', 'substepNumber', 'substepName'], {}, update_active_substep),
    'add_memory_entry': (['flowDir', 'stepId', 'topic'], {}, add_memory_entry),
    'read_memory_topic': (['flowDir', 'stepId', 'topic'], {}, read_memory_topic),
    'add_log_entry': (['flowDir', 'stepId'], {}, add_log_entry),
    'log_interaction': (['flowDir', 'stepId', 'request', 'reason', 'response'], {}, log_interaction),
    'update_flow_status': (['flowDir', 'status'], {'status': FLOW_STATUSES}, update_flow_status),
    'register_child_flow': (['flowDir', 'childId', 'childName', 'childStatus', 'spawnedAtStep', 'syncPoint', 'childFlowPath'], {'childStatus': FLOW_STATUSES}, register_child_flow),
    'update_child_status': (['flowDir', 'childId', 'childStatus'], {'childStatus': FLOW_STATUSES}, update_child_status),
    'update_log_observations': (['flowDir'], {}, update_log_observations),
    'write_finding': (['flowDir', 'category', 'title', 'what', 'why', 'impact'], {}, write_finding),
    'list_findings': ([], {'status': ['open'] + FINDING_STATUSES}, list_findings),
    'update_finding_status': (['flowId', 'findingId', 'status'], {'status': FINDING_STATUSES}, update_finding_status),
    'approve_step': (['flowDir', 'stepId'], {}, approve_step),
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
