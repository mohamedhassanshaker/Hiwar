#!/usr/bin/env python3
"""The documentation structure of a project: numbered areas, README index, rules.md.

The structure is `docs_structure` in <project>/.claude/xyz.json, else ../structure.default.json. Paths come from xyz_config.

  docs_structure.py init     create missing area folders, docs/README.md and docs/rules.md (never overwrites a file)
  docs_structure.py index    regenerate the area table in docs/README.md from the structure
  docs_structure.py check    areas and required files exist, no unknown top-level folders, every relative link in docs/ resolves
"""
import json, os, re, sys, glob, datetime

import xyz_config

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = xyz_config.load()
ROOT = CFG['root']
S = CFG['docs_structure'] or json.load(open(os.path.join(HERE, '..', 'structure.default.json'), encoding='utf-8'))
DOCS = CFG['docs_root_abs']
RULES_TEMPLATE = os.path.join(HERE, '..', 'rules.template.md')
M = ('<!-- areas:start -->', '<!-- areas:end -->')


def table():
    rows = ['| Folder | Area | Holds |', '| --- | --- | --- |']
    for a in S['areas']:
        rows.append(f"| [{a['dir']}]({a['dir']}/) | {a['title']} | {a['holds']} |")
    return '\n'.join(rows)


def readme():
    return f"""---
title: Documentation
status: approved
owner: Product owner
related: [rules.md]
version: 1.0
last-updated: {datetime.date.today().isoformat()}
---

# Documentation

Project documentation, numbered by area. [rules.md](rules.md) says what goes where and how documents are written and kept.

{M[0]}

{table()}

{M[1]}
"""


def rules():
    t = open(RULES_TEMPLATE, encoding='utf-8').read()
    area_list = ', '.join(f"`{a['dir']}`" for a in S['areas'])
    rows = '\n'.join(['| Area | Holds |', '| --- | --- |'] + [f"| {a['dir']} | {a['holds']} |" for a in S['areas']])
    for k, v in (('{{AREA_LIST}}', area_list), ('{{AREAS_TABLE}}', rows), ('{{BUSINESS_SPEC}}', CFG['business_spec']), ('{{SPECS_DIR}}', CFG['specs_dir']), ('{{PM_DIR}}', CFG['pm_dir']), ('{{TODAY}}', datetime.date.today().isoformat())):
        t = t.replace(k, v)
    return t


def init():
    os.makedirs(DOCS, exist_ok=True)
    made = []
    for a in S['areas']:
        for sub in [''] + a['folders']:
            p = os.path.join(DOCS, a['dir'], sub)
            if not os.path.isdir(p): os.makedirs(p); made.append(os.path.relpath(p, ROOT))
    for name, content in (('README.md', readme()), ('rules.md', rules())):
        p = os.path.join(DOCS, name)
        if content is not None and not os.path.exists(p):
            open(p, 'w', encoding='utf-8').write(content); made.append(os.path.relpath(p, ROOT))
    print('created: ' + (', '.join(made) if made else 'nothing (structure already in place)'))


def index():
    p = os.path.join(DOCS, 'README.md')
    t = open(p, encoding='utf-8').read()
    t = re.sub(re.escape(M[0]) + '.*' + re.escape(M[1]), lambda m: f'{M[0]}\n\n{table()}\n\n{M[1]}', t, flags=re.S)
    open(p, 'w', encoding='utf-8').write(t)
    print('index updated')


def check():
    bad = []
    dirs = {a['dir'] for a in S['areas']}
    for a in S['areas']:
        base = os.path.join(DOCS, a['dir'])
        if not os.path.isdir(base): bad.append(f"missing area folder {a['dir']}"); continue
        bad += [f"missing {a['dir']}/{x}" for x in a['files'] if not os.path.exists(os.path.join(base, x))]
        bad += [f"missing folder {a['dir']}/{x}" for x in a['folders'] if not os.path.isdir(os.path.join(base, x))]
    bad += [f'missing docs/{x}' for x in S['root_files'] if not os.path.exists(os.path.join(DOCS, x))]
    for d in sorted(os.listdir(DOCS)):
        if os.path.isdir(os.path.join(DOCS, d)) and d not in dirs: bad.append(f'folder docs/{d} is not in the structure')
    for f in glob.glob(DOCS + '/**/*.md', recursive=True):
        t = re.sub(r'```.*?```', '', open(f, encoding='utf-8').read(), flags=re.S)
        for m in re.finditer(r'\]\(([^)\s#]+)(?:#[^)]*)?\)', t):
            tgt = m.group(1)
            if re.match(r'[a-z<]+[:/]', tgt) or tgt.startswith('<'): continue
            if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), tgt))):
                bad.append(f'broken link in {os.path.relpath(f, ROOT)}: {tgt}')
    print(f'docs: {len(S["areas"])} areas, {len(bad)} problems')
    for b in bad: print(b)
    return 1 if bad else 0


if __name__ == '__main__':
    c = sys.argv[1] if len(sys.argv) > 1 else ''
    if c == 'init': init()
    elif c == 'index': index()
    elif c == 'check': sys.exit(check())
    else: print(__doc__)
