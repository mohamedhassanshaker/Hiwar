#!/usr/bin/env python3
"""Spec backlog and completed specs in the project-management folder (xyz_config: pm_dir).

  specs_board.py init [--force]                 create specs-pending.md (every spec pending) and specs-completed.md
  specs_board.py sync                           add specs missing from both files to the backlog, report rows whose spec is gone
  specs_board.py complete ID [ID...] --evidence "..."   move specs from the backlog to specs-completed.md
  specs_board.py reopen ID [ID...]              move specs from specs-completed.md back to the backlog
  specs_board.py check                          every spec is in exactly one file; every row has a spec
"""
import re, sys, os, glob, datetime

import xyz_config

CFG = xyz_config.load()
ROOT = CFG['root']
SPECS = CFG['specs_dir_abs']
PM = CFG['pm_dir_abs']
BACKLOG, DONE, TASKS = (os.path.join(PM, n) for n in ('specs-pending.md', 'specs-completed.md', 'task-backlog.md'))
RELSPECS = os.path.relpath(SPECS, PM).replace(os.sep, '/')
MARK = ('<!-- rows:start -->', '<!-- rows:end -->')
BACKLOG_HEAD = '| ID | Feature | Module | Screens | FRs | Implementation hint |\n| --- | --- | --- | --- | --- | --- |'
DONE_HEAD = '| ID | Feature | Module | Completed | Evidence |\n| --- | --- | --- | --- | --- |'


def specs():
    out = {}
    for f in sorted(glob.glob(SPECS + '/**/spec.md', recursive=True)):
        t = open(f, encoding='utf-8').read()
        fid = re.search(r'\*\*Feature ID\*\*: (\S+)', t).group(1)
        rel = os.path.relpath(f, SPECS)
        out[fid] = dict(
            title=re.match(r'# Feature Specification: (.*)', t).group(1).strip(),
            module=rel.split(os.sep)[0].upper() if not rel.startswith('aic' + os.sep) else 'AIC',
            screens=(re.search(r'\*\*Screens\*\*: (.*)', t) or [None, ''])[1].strip(),
            frs=len(re.findall(r'^- \*\*FR-\d+\*\*', t, re.M)),
            path=rel.replace(os.sep, '/'))
    return out


def task_status():
    """Screen -> status from the implementation task backlog (hint only)."""
    st = {}
    if os.path.exists(TASKS):
        for l in open(TASKS, encoding='utf-8'):
            m = re.match(r'\|\s*[\d.]+\s*\|\s*`([^`]+)`[^|]*\|[^|]*\|\s*([a-z() ]+?)\s*\|', l)
            if m: st[m.group(1).split(' ')[0]] = m.group(2)
    return st


def hint(sp, st):
    screens = [s.strip() for s in re.split(r'[,;]', sp['screens']) if s.strip()]
    got = [f'{s}: {st[s]}' for s in screens if s in st]
    return '; '.join(got)


def link(fid, sp):
    return f"[{sp['title']}]({RELSPECS}/{sp['path']})"


def read_rows(path):
    if not os.path.exists(path): return {}
    t = open(path, encoding='utf-8').read()
    a, b = t.index(MARK[0]), t.index(MARK[1])
    rows = {}
    for l in t[a:b].split('\n'):
        m = re.match(r'\| ([A-Z]{2,3}-\d{3}) \|', l)
        if m: rows[m.group(1)] = l
    return rows


def write_rows(path, rows, head):
    t = open(path, encoding='utf-8').read()
    a, b = t.index(MARK[0]), t.index(MARK[1])
    body = head + '\n' + '\n'.join(rows[k] for k in sorted(rows, key=lambda k: (k.split('-')[0], k)))
    t = t[:a] + MARK[0] + '\n\n' + body + '\n\n' + t[b:]
    t = re.sub(r'last-updated: \S+', 'last-updated: ' + datetime.date.today().isoformat(), t, count=1)
    open(path, 'w', encoding='utf-8').write(t)


def backlog_row(fid, sp, st):
    return f"| {fid} | {link(fid, sp)} | {sp['module']} | {sp['screens']} | {sp['frs']} | {hint(sp, st)} |"


def header(title, intro):
    if not os.path.exists(os.path.join(SPECS, 'README.md')): intro = intro.replace('[specs](SPECS_README)', 'specs')
    intro = intro.replace('SPECS_README', RELSPECS + '/README.md')
    for name in ('task-backlog.md', 'blockers.md'):  # link optional files only when they exist
        if not os.path.exists(os.path.join(PM, name)): intro = intro.replace(f'[{name}]({name})', f'`{name}`')
    return f"""---
title: {title}
status: draft
owner: Project manager
related: [specs-pending.md, specs-completed.md]
version: 1.0
last-updated: {datetime.date.today().isoformat()}
---

# {title}

{intro}

{MARK[0]}

{MARK[1]}
"""


def init(force):
    sp, st = specs(), task_status()
    if (os.path.exists(BACKLOG) or os.path.exists(DONE)) and not force: sys.exit('specs-pending.md or specs-completed.md exists (use --force)')
    open(BACKLOG, 'w', encoding='utf-8').write(header('Spec backlog', """Feature specs ([specs](SPECS_README)) that are not yet built and accepted. A spec leaves this list only through `specs_board.py complete`, which moves its row to [completed specs](specs-completed.md). Implementation task status is in [task-backlog.md](task-backlog.md), blockers in [blockers.md](blockers.md).

The hint column shows the status of the spec's screens in the task backlog. It does not mean the spec is complete: a spec is complete only when every requirement and acceptance scenario in it is implemented and its tests pass."""))
    open(DONE, 'w', encoding='utf-8').write(header('Completed specs', """Feature specs whose requirements and acceptance scenarios are all implemented, with the evidence (tests, deployment) that shows it. Rows come from [specs-pending.md](specs-pending.md) through `specs_board.py complete`; `reopen` returns a row when its spec gains requirements that are not built."""))
    write_rows(BACKLOG, {k: backlog_row(k, v, st) for k, v in sp.items()}, BACKLOG_HEAD)
    write_rows(DONE, {}, DONE_HEAD)
    print(f'backlog: {len(sp)} specs pending, completed: 0')


def sync():
    sp, st = specs(), task_status()
    b, d = read_rows(BACKLOG), read_rows(DONE)
    new = [k for k in sp if k not in b and k not in d]
    for k in new: b[k] = backlog_row(k, sp[k], st)
    for k in b:  # refresh descriptive columns of pending specs
        if k in sp: b[k] = backlog_row(k, sp[k], st)
    write_rows(BACKLOG, b, BACKLOG_HEAD)
    gone = [k for k in list(b) + list(d) if k not in sp]
    print(f'added {len(new)}; rows without a spec: {gone or "none"}')
    return 1 if gone else 0


def complete(ids, evidence):
    sp = specs(); b, d = read_rows(BACKLOG), read_rows(DONE)
    for i in ids:
        if i not in b: sys.exit(f'{i} is not in the backlog')
        s = sp[i]
        d[i] = f"| {i} | {link(i, s)} | {s['module']} | {datetime.date.today().isoformat()} | {evidence} |"
        del b[i]
    write_rows(BACKLOG, b, BACKLOG_HEAD); write_rows(DONE, d, DONE_HEAD)
    print(f'completed {", ".join(ids)}; pending {len(b)}, completed {len(d)}')


def reopen(ids):
    sp, st = specs(), task_status(); b, d = read_rows(BACKLOG), read_rows(DONE)
    for i in ids:
        if i not in d: sys.exit(f'{i} is not in completed specs')
        b[i] = backlog_row(i, sp[i], st); del d[i]
    write_rows(BACKLOG, b, BACKLOG_HEAD); write_rows(DONE, d, DONE_HEAD)
    print(f'reopened {", ".join(ids)}')


def check():
    sp = specs(); b, d = read_rows(BACKLOG), read_rows(DONE)
    bad = [f'{k} in both files' for k in b if k in d] + [f'{k} in no file' for k in sp if k not in b and k not in d] + [f'{k} has no spec' for k in list(b) + list(d) if k not in sp]
    print(f'board: {len(b)} pending, {len(d)} completed, {len(bad)} problems')
    for x in bad: print(x)
    return 1 if bad else 0


if __name__ == '__main__':
    a = sys.argv[1:]
    cmd = a[0] if a else ''
    if cmd == 'init': init('--force' in a)
    elif cmd == 'sync': sys.exit(sync())
    elif cmd == 'complete':
        if '--evidence' not in a: sys.exit('--evidence is required')
        e = a.index('--evidence'); complete([x for x in a[1:e]], ' '.join(a[e + 1:]))
    elif cmd == 'reopen': reopen(a[1:])
    elif cmd == 'check': sys.exit(check())
    else: print(__doc__)
