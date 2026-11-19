#!/usr/bin/env python3
"""Change requests in change_requests_dir: `CR-NNN-slug.md` with front matter
`status: received | applied | rejected`, `kind: business | ui | technical`, `supersedes: [section keys]`.

  cr.py list                          every change request with status, kind, title and specs
  cr.py apply CR-NNN                  after the documents are updated: check the request's sections are covered, record
                                      the specs that claim them, add new specs to the backlog, reopen completed specs it changed
  cr.py reject CR-NNN --reason "..."  record the owner's rejection
  cr.py check                         statuses are valid; every applied request lists specs that exist
"""
import datetime, os, re, sys

import xyz_config
import coverage
import specs_board

CFG = xyz_config.load()
STATUSES = ('received', 'applied', 'rejected')


def find(cid):
    c = next((c for c in CFG['change_requests'] if c['id'] == cid), None)
    if not c: sys.exit(f'unknown change request {cid} in {CFG["change_requests_dir"]}')
    return c


def title(c):
    m = re.search(r'^# (.*)$', open(c['abs'], encoding='utf-8').read(), re.M)
    return c['fm'].get('title') or (m.group(1).strip() if m else c['id'])


def set_front_matter(path, updates):
    t = open(path, encoding='utf-8').read().replace('\r\n', '\n')
    m = re.match(r'---\n(.*?)\n---\n?', t, re.S)
    lines = m.group(1).split('\n') if m else []
    body = t[m.end():] if m else t
    for k, v in updates.items():
        v = '[' + ', '.join(v) + ']' if isinstance(v, list) else v
        i = next((n for n, l in enumerate(lines) if l.split(':', 1)[0].strip() == k), None)
        if i is None: lines.append(f'{k}: {v}')
        else: lines[i] = f'{k}: {v}'
    xyz_config.write(path, '---\n' + '\n'.join(lines) + '\n---\n' + body.lstrip('\n'))


def spec_ids_claiming(keys):
    out = set()
    for f in coverage.spec_files():
        t = open(f, encoding='utf-8').read()
        m = coverage.FID_RE.search(t)
        if m and coverage.source_keys(t) & keys: out.add(m.group(1))
    return sorted(out)


def apply(cid):
    c = find(cid)
    if c['status'] == 'rejected': sys.exit(f'{cid} is rejected')
    src = next(s for s in CFG['sources'] if s.get('id') == cid)
    secs = [(src, x) for x in coverage.source_sections(src)]
    if not secs: sys.exit(f'{cid} has no requirement text')
    print(f'coverage of {cid}:')
    if coverage.verify(secs): sys.exit(f'{cid} is not applied: fix the problems above in the documents first')
    specs = spec_ids_claiming({k for _, (k, *_r) in secs})
    if c['kind'] != 'technical' and not specs: sys.exit(f'no feature spec claims a section of {cid}')
    set_front_matter(c['abs'], {'status': 'applied', 'applied': datetime.date.today().isoformat(), 'specs': specs})
    specs_board.sync()
    done = specs_board.read_rows(specs_board.DONE)
    reopen = [i for i in specs if i in done]
    if reopen: specs_board.reopen(reopen)
    pending = specs_board.read_rows(specs_board.BACKLOG)
    print(f'{cid} applied; specs: {", ".join(specs) or "none"}; pending now: {", ".join(i for i in specs if i in pending) or "none"}')
    return 0


def reject(cid, reason):
    find(cid)
    set_front_matter(find(cid)['abs'], {'status': 'rejected', 'rejected': datetime.date.today().isoformat(), 'reason': reason})
    print(f'{cid} rejected')
    return 0


def check():
    known = set(specs_board.specs())
    bad, ids = [], [c['id'] for c in CFG['change_requests']]
    bad += [f'duplicate change request {i}' for i in sorted({i for i in ids if ids.count(i) > 1})]
    for c in CFG['change_requests']:
        if c['status'] not in STATUSES: bad.append(f'{c["id"]}: status "{c["status"]}" is not one of {", ".join(STATUSES)}')
        if c['kind'] not in ('business', 'ui', 'technical'): bad.append(f'{c["id"]}: kind "{c["kind"]}" is not business, ui or technical')
        if c['status'] == 'applied':
            bad += [f'{c["id"]}: lists unknown spec {s}' for s in c['specs'] if s not in known]
    received = [c['id'] for c in CFG['change_requests'] if c['status'] == 'received']
    print(f'change requests: {len(ids)}, received (not applied): {", ".join(received) or "none"}, {len(bad)} problems')
    for b in bad: print(b)
    return 1 if bad else 0


def main():
    a = sys.argv[1:]
    cmd = a[0] if a else ''
    if cmd == 'list':
        for c in CFG['change_requests']:
            print(f'{c["id"]}\t{c["status"]}\t{c["kind"]}\t{title(c)}\t{", ".join(c["specs"])}')
        return 0
    if cmd == 'apply' and len(a) == 2: return apply(a[1])
    if cmd == 'reject' and '--reason' in a: return reject(a[1], ' '.join(a[a.index('--reason') + 1:]))
    if cmd == 'check': return check()
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
