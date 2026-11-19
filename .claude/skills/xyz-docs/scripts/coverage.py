#!/usr/bin/env python3
"""Coverage of the requirement sources by the documents derived from them (paths and ID patterns from xyz_config).

  coverage.py index [--kind KIND]       list section keys (with source file and line ranges)
  coverage.py readme                    regenerate the feature index in specs/README.md
  coverage.py lint                      check spec structure (template headers, IDs, FR numbering)
  coverage.py verify [--only KEYFILE]   exit 1 unless every section, ID, unit number and quoted message is covered
  coverage.py trace                     exit 1 unless every feature ID is cited by a document in architecture_dirs

Business and UI sources are claimed by feature specs (`**Sources**:` line). Technical sources are claimed by any
document under docs_root (`**Sources**:` line or `sources: [..]` in the front matter). Change requests in
change_requests_dir are sources too (prefix CR-NNN); sections a change request lists in `supersedes` are checked
for claims and IDs only.
"""
import re, sys, glob, os, collections

import xyz_config

CFG = xyz_config.load()
ROOT = CFG['root']
SPECS = CFG['specs_dir_abs']
DOCS = CFG['docs_root_abs']

_ID_PATTERNS = [r'(?:BR|BL)-[A-Z]+-\d+', r'(?:SR|AC)-[A-Za-z]+(?:-[A-Za-z]+)*-\d+(?:-\d+)?', r'(?:IX|SM|PR|FO)-\d+', r'P-\d+'] + CFG['id_patterns']
ID_RE = re.compile(r'\b(?:' + '|'.join(_ID_PATTERNS) + r')\b')
UNIT_RE = re.compile(r'(?:AED|SAR)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:%|percent|days?|hours?|minutes?|seconds?|months?|years?|weeks?|working days|seats|employees|credits|questions|points|ms|px|GB|MB|attempts|rounds|characters|times)\b|\d[\d,]*(?:\.\d+)?%')
QUOTE_RE = re.compile(r'[“"]([^“”"\n]{12,}?)[”"]')
FID_RE = re.compile(r'^\*\*Feature ID\*\*: ([A-Z]{2,3}-\d{3})$', re.M)


def norm(s):
    s = s.replace('’', "'").replace('“', '"').replace('”', '"').replace('–', '-').replace('—', '-')
    s = re.sub(r'[`*_]', '', s)
    return re.sub(r'\s+', ' ', s).strip().lower()


def slug(s):
    s = re.sub(r'[`*(){}\[\]<>?!,.:;"\'’]|\*\*', '', s.lower())
    s = re.sub(r'[^a-z0-9؀-ۿ]+', '-', s).strip('-')
    return s[:40].rstrip('-')


def read(p):
    return open(p, encoding='utf-8').read()


def source_sections(src):
    """Leaf sections of one source: (key, heading, start line, end line, text).

    Key: `<prefix>:` (when set) + `P<n>` (inside a `## Part n` heading) + `/` + heading number, or the nearest
    numbered parent and a slug of the heading. Text before the first `##` heading is the section `intro`.
    """
    L = read(src['abs']).split('\n')
    pre = src['prefix'] + ':' if src['prefix'] else ''
    heads, fence = [], False
    for i, l in enumerate(L):
        if l.startswith('```'): fence = not fence
        m = None if fence else re.match(r'(#{2,6}) (.*)', l)
        if m: heads.append((i, len(m.group(1)), m.group(2).strip()))
    out = []
    first = heads[0][0] if heads else len(L)
    body = '\n'.join(l for l in L[:first] if not l.startswith('# ')).strip()
    body = re.sub(r'\A---\n.*?\n---', '', body, flags=re.S).strip(' \n-')  # front matter is not a requirement
    if body: out.append((pre + '/intro', 'Introduction', 1, first, '\n'.join(L[:first])))
    part, stack = '', []
    for n, (i, lvl, title) in enumerate(heads):
        mm = re.match(r'Part (\d+)', title) if lvl == 2 else None
        if mm:
            part, stack = 'P' + mm.group(1), []
            continue
        stack = [s for s in stack if s[0] < lvl] + [(lvl, title)]
        nxt = heads[n + 1][1] if n + 1 < len(heads) else 0
        end = heads[n + 1][0] if n + 1 < len(heads) else len(L)
        if nxt > lvl and not '\n'.join(L[i + 1:end]).strip(' \n-'):
            continue  # a parent heading without its own text
        parts = []
        for l2, t in stack:
            m = re.match(r'(\d+(?:\.\d+)+|\d+(?=\.? ))\.? ', t)
            if m and l2 > 3 and '.' not in m.group(1): m = None
            parts.append(m.group(1) if m else slug(t))
        key = part + '/' + (parts[-1] if re.fullmatch(r'\d+(?:\.\d+)*', parts[-1]) else '/'.join(parts[-2:]))
        out.append((pre + key, title, i + 1, end, '\n'.join(L[i:end])))
    return out


def sections(kinds=None):
    return [(s, x) for s in CFG['sources'] if not kinds or s['kind'] in kinds for x in source_sections(s)]


def spec_files():
    return sorted(glob.glob(SPECS + '/**/spec.md', recursive=True))


def claim_files(kind):
    if kind != 'technical': return spec_files()
    own = {os.path.normpath(s['abs']) for s in CFG['sources']}
    return sorted(f for f in glob.glob(DOCS + '/**/*.md', recursive=True) if os.path.normpath(f) not in own)


def source_keys(text):
    keys = set()
    m = re.search(r'^\*\*Sources\*\*:(.*(?:\n(?:- |  ).*)*)', text, re.M)
    if m: keys |= set(re.findall(r'`([^`]+)`', m.group(1)))
    fm = re.match(r'---\n(.*?)\n---', text, re.S)
    m = fm and re.search(r'^sources:\s*\[(.*)\]', fm.group(1), re.M)
    if m: keys |= {k.strip().strip('`"\'') for k in m.group(1).split(',') if k.strip()}
    return keys


def lint():
    bad = []
    ids = collections.Counter()
    for f in spec_files():
        t = read(f)
        rel = os.path.relpath(f, SPECS)
        folder = os.path.basename(os.path.dirname(f))
        if not re.match(r'\d{3}-[a-z0-9-]+$', folder): bad.append(f'{rel}: folder must be NNN-kebab-slug')
        if not re.match(r'# Feature Specification: \S', t): bad.append(f'{rel}: missing "# Feature Specification:" title')
        m = FID_RE.search(t)
        if not m: bad.append(f'{rel}: missing Feature ID')
        else:
            ids[m.group(1)] += 1
            if m.group(1).split('-')[1] != folder[:3]: bad.append(f'{rel}: Feature ID number differs from folder number')
        for h in ('**Module**:', '**Status**:', '**Sources**:', '## User Scenarios & Testing', '## Requirements', '### Functional Requirements', '## Success Criteria', '## Assumptions'):
            if h not in t: bad.append(f'{rel}: missing {h}')
        if not source_keys(t): bad.append(f'{rel}: no source keys')
        frs = re.findall(r'^- \*\*FR-(\d+)\*\*', t, re.M)
        if not frs: bad.append(f'{rel}: no functional requirements')
        elif [int(x) for x in frs] != list(range(1, len(frs) + 1)): bad.append(f'{rel}: FR numbers not sequential from 001')
        if '**Acceptance Scenarios**' not in t and '[NEEDS CLARIFICATION' not in t: bad.append(f'{rel}: no Acceptance Scenarios (or a clarification for missing criteria)')
        if len(t.split('\n')) > 400: bad.append(f'{rel}: over 400 lines, split the feature')
    for i, c in ids.items():
        if c > 1: bad.append(f'duplicate Feature ID {i}')
    print(f'lint: {len(spec_files())} specs, {len(bad)} problems')
    for b in bad: print(b)
    return 1 if bad else 0


def readme():
    """Regenerate the block between the feature markers in specs/README.md."""
    modules = dict(CFG['modules'])
    rows = []
    for f in spec_files():
        rel = os.path.relpath(f, SPECS).replace(os.sep, '/').split('/')
        t = read(f)
        title = re.match(r'# Feature Specification: (.*)', t).group(1).strip()
        rows.append((rel[0], FID_RE.search(t).group(1), title, '/'.join(rel)))
    out = ['<!-- features:start -->', '', '## Features by module', '']
    for mod in list(modules) + sorted({r[0] for r in rows if r[0] not in modules}):
        mine = sorted((r for r in rows if r[0] == mod), key=lambda r: r[3])
        if not mine: continue
        out += [f'### [{mod}]({mod}/README.md) — {modules.get(mod, mod.upper())}', '', '| ID | Feature |', '| --- | --- |']
        out += [f'| {fid} | [{title}]({path}) |' for _, fid, title, path in mine]
        out.append('')
    out.append('<!-- features:end -->')
    p = os.path.join(SPECS, 'README.md')
    t = re.sub(r'<!-- features:start -->.*<!-- features:end -->', lambda m: '\n'.join(out), read(p), flags=re.S)
    xyz_config.write(p, t)
    print(f'readme: {len(rows)} features')
    return 0


def trace():
    """Every feature is realised somewhere in the architecture documents."""
    arch = ' '.join(read(f) for d in CFG['architecture_dirs_abs'] for f in glob.glob(d + '/**/*.md', recursive=True))
    fids = sorted(FID_RE.search(read(f)).group(1) for f in spec_files() if FID_RE.search(read(f)))
    bad = [f'{i} is not cited in {", ".join(CFG["architecture_dirs"])}' for i in fids if not re.search(r'(?<![A-Z0-9-])' + i + r'(?!\d)', arch)]
    print(f'trace: {len(fids)} features, {len(bad)} problems')
    for b in bad: print(b)
    return 1 if bad else 0


def verify(secs):
    problems = []
    keys = collections.Counter(k for _, (k, *_r) in sections())
    problems += [f'duplicate section key {k}' for k, c in keys.items() if c > 1]
    texts, claimed = {}, collections.defaultdict(list)
    for kind in {s['kind'] for s in CFG['sources']}:
        for f in claim_files(kind):
            texts.setdefault(f, read(f))
            for k in source_keys(texts[f]):
                if f not in claimed[(kind == 'technical', k)]: claimed[(kind == 'technical', k)].append(f)
    unknown = collections.defaultdict(set)
    for (_, k), fs in claimed.items():
        if k not in keys: unknown[k] |= {os.path.relpath(x, ROOT).replace(os.sep, '/') for x in fs}
    problems += [f'unknown source key {k} in {sorted(fs)}' for k, fs in unknown.items()]
    # A change request names the sections it changes; their old values and messages are no longer required.
    superseded = {k: c['id'] for c in CFG['change_requests'] if c['status'] != 'rejected' for k in c['supersedes']}
    problems += [f'{c}: supersedes unknown section {k}' for k, c in superseded.items() if k not in keys]
    for src, (k, t, a, b, body) in secs:
        fs = claimed.get((src['kind'] == 'technical', k))
        if not fs:
            problems.append(f'UNCLAIMED section {k} ({src["path"]} lines {a}-{b}) {t}'); continue
        raw = ' '.join(texts[f] for f in fs)
        mapped = norm(raw)
        for i in sorted(set(ID_RE.findall(body))):
            if not re.search(r'(?<![A-Za-z0-9-])' + re.escape(i) + r'(?![A-Za-z0-9-])', raw): problems.append(f'{k}: ID {i} missing from mapped documents')
        if k in superseded: continue
        for u in sorted(set(UNIT_RE.findall(body))):
            if norm(u) not in mapped and norm(u).replace(' ', '') not in mapped.replace(' ', ''): problems.append(f'{k}: value "{u}" missing from mapped documents')
        for q in sorted(set(QUOTE_RE.findall(body))):
            if norm(q) not in mapped: problems.append(f'{k}: quoted text "{q[:60]}" missing from mapped documents')
    print(f'{len(spec_files())} specs, {len(secs)} sections, {len(problems)} problems')
    for p in problems: print(p)
    return 1 if problems else 0


def main():
    a = sys.argv[1:]
    cmd = a[0] if a else 'verify'
    if cmd == 'lint': return lint()
    if cmd == 'readme': return readme()
    if cmd == 'trace': return trace()
    secs = sections([a[a.index('--kind') + 1]] if '--kind' in a else None)
    if '--only' in a:
        only = {l.split('\t')[0].strip() for l in open(a[a.index('--only') + 1], encoding='utf-8') if l.strip()}
        secs = [s for s in secs if s[1][0] in only]
    if cmd == 'index':
        for src, (k, t, s, e, _) in secs: print(f'{k}\t{src["path"]}:{s}-{e}\t{src["kind"]}\t{t}')
        return 0
    if cmd == 'verify': return verify(secs)
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
