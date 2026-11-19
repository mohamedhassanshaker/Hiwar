"""Project settings shared by the xyz-docs scripts: <project>/.claude/xyz.json over built-in defaults.

Keys (paths relative to the project root):
  docs_root, specs_dir, pm_dir
  requirement_sources  [{path, kind: business|ui|technical, prefix}]; without it, business_spec is the one source
  change_requests_dir  folder of change requests `CR-NNN-slug.md`; each one not rejected is a source with prefix CR-NNN
  design_boards        folder or zip of `*.dc.html` design artboards (UI coverage)
  architecture_dirs    folders whose documents realise the feature specs (trace check)
  e2e                  {test_dir, run}: end-to-end test folder and the command that runs the suite (xyz-e2e)
  implement            {verify, deploy {path prefix: command}}: project checks and per-component deploy (xyz-implement)
  modules {code: title}, crosscutting_module, id_patterns [regex, ...], docs_structure
Set XYZ_ROOT to point the scripts at another project root.
"""
import contextlib
import glob
import json
import os
import re

DEFAULTS = {
    'docs_root': 'docs',
    'business_spec': 'docs/00-input-requirements/business-specification.md',
    'requirement_sources': None,
    'specs_dir': 'docs/01-product-requirements/specs',
    'pm_dir': 'docs/10-project-management',
    'change_requests_dir': 'docs/00-input-requirements/change-requests',
    'design_boards': None,
    'architecture_dirs': ['docs/02-architecture', 'docs/03-decisions', 'docs/04-api-and-integrations', 'docs/05-data', 'docs/06-security'],
    'e2e': {'test_dir': 'tests/e2e', 'run': 'npx playwright test'},
    'implement': {'verify': None, 'deploy': {}},
    'modules': {},
    'crosscutting_module': 'platform',
    'id_patterns': [],
    'docs_structure': None,
}


def find_root():
    if os.environ.get('XYZ_ROOT'): return os.path.abspath(os.environ['XYZ_ROOT'])
    d = os.path.dirname(os.path.abspath(__file__))
    while True:
        if os.path.isdir(os.path.join(d, '.claude', 'skills')): return d
        parent = os.path.dirname(d)
        if parent == d: raise SystemExit('project root not found: no .claude/skills above the script')
        d = parent


def load():
    root = find_root()
    cfg = dict(DEFAULTS)
    path = os.path.join(root, '.claude', 'xyz.json')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as fh: cfg.update(json.load(fh))
    cfg['root'] = root
    for k in ('docs_root', 'business_spec', 'specs_dir', 'pm_dir'): cfg[k + '_abs'] = os.path.join(root, cfg[k])
    srcs = cfg['requirement_sources'] or [{'path': cfg['business_spec'], 'kind': 'business', 'prefix': ''}]
    cfg['sources'] = [dict(s, prefix=s.get('prefix', ''), kind=s.get('kind', 'business'), abs=os.path.join(root, s['path'])) for s in srcs]
    cfg['change_requests_dir_abs'] = os.path.join(root, cfg['change_requests_dir'])
    cfg['change_requests'] = change_requests(cfg['change_requests_dir_abs'])
    cfg['sources'] += [dict(c, path=os.path.relpath(c['abs'], root).replace(os.sep, '/'), prefix=c['id']) for c in cfg['change_requests'] if c['status'] != 'rejected']
    cfg['architecture_dirs_abs'] = [os.path.join(root, d) for d in cfg['architecture_dirs']]
    return cfg


def front_matter(text):
    """Flat YAML front matter: {key: str or [str]}."""
    m = re.match(r'---\r?\n(.*?)\r?\n---', text, re.S)
    out = {}
    for line in (m.group(1).splitlines() if m else []):
        k, sep, v = line.partition(':')
        if not sep or line.startswith(' '): continue
        v = v.strip()
        out[k.strip()] = [x.strip().strip('`"\'') for x in v[1:-1].split(',') if x.strip()] if v.startswith('[') and v.endswith(']') else v
    return out


def change_requests(folder):
    """Change requests `CR-NNN-slug.md`: id, status (received | applied | rejected), kind, supersedes, specs."""
    out = []
    for f in sorted(glob.glob(os.path.join(folder, 'CR-[0-9][0-9][0-9]-*.md'))):
        fm = front_matter(open(f, encoding='utf-8').read())
        out.append({'id': os.path.basename(f)[:6], 'abs': f, 'status': fm.get('status', 'received'), 'kind': fm.get('kind', 'business'),
                    'supersedes': fm.get('supersedes') or [], 'specs': fm.get('specs') or [], 'fm': fm})
    return out


def write(path, text):
    """Write UTF-8 with LF line ends on every platform."""
    with open(path, 'w', encoding='utf-8', newline='\n') as fh: fh.write(text)


@contextlib.contextmanager
def locked(fh):
    """Exclusive lock on an open file (flock on POSIX, msvcrt on Windows)."""
    try:
        import fcntl
    except ImportError:
        import msvcrt
        fh.seek(0); msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)
        try:
            yield
        finally:
            fh.seek(0); msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        return
    fcntl.flock(fh, fcntl.LOCK_EX)
    yield
