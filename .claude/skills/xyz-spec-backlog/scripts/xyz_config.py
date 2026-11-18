"""Project settings shared by the xyz skills: <project>/.claude/xyz.json over built-in defaults.

Keys: docs_root, business_spec, specs_dir, pm_dir (paths relative to the project root), modules {code: title},
crosscutting_module, id_patterns [regex, ...] (added to the built-in requirement ID patterns), docs_structure.
Set XYZ_ROOT to point the scripts at another project root.
"""
import json
import os

DEFAULTS = {
    'docs_root': 'docs',
    'business_spec': 'docs/00-input-requirements/business-specification.md',
    'specs_dir': 'docs/01-product-requirements/specs',
    'pm_dir': 'docs/10-project-management',
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
    return cfg
