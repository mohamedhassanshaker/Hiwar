#!/usr/bin/env python3
"""Coverage of the business specification by the feature specs (paths and ID patterns from xyz_config).

  coverage.py index [--module CODE]   list section keys (with line ranges) and unclaimed IDs
  coverage.py readme                  regenerate the feature index in specs/README.md
  coverage.py lint                    check spec structure (template headers, IDs, FR numbering)
  coverage.py verify [--only KEYFILE] exit 1 unless every section, ID, unit number and quoted message is covered
"""
import re, sys, glob, os, collections

import xyz_config

CFG = xyz_config.load()
ROOT = CFG['root']
BS = CFG['business_spec_abs']
SPECS = CFG['specs_dir_abs']

_ID_PATTERNS = [r'(?:BR|BL)-[A-Z]+-\d+', r'(?:SR|AC)-[A-Za-z]+(?:-[A-Za-z]+)*-\d+(?:-\d+)?', r'(?:IX|SM|PR|FO)-\d+', r'P-\d+'] + CFG['id_patterns']
ID_RE = re.compile(r'\b(?:' + '|'.join(_ID_PATTERNS) + r')\b')
UNIT_RE = re.compile(r'(?:AED|SAR)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:%|percent|days?|hours?|minutes?|seconds?|months?|years?|weeks?|working days|seats|employees|credits|questions|points|ms|px|GB|MB|attempts|rounds|characters|times)\b|\d[\d,]*(?:\.\d+)?%')
QUOTE_RE = re.compile(r'[“"]([^“”"\n]{12,}?)[”"]')


def norm(s):
    s = s.replace('’', "'").replace('“', '"').replace('”', '"').replace('–', '-').replace('—', '-')
    s = re.sub(r'[`*_]', '', s)
    return re.sub(r'\s+', ' ', s).strip().lower()


def slug(s):
    s = re.sub(r'[`*(){}\[\]<>?!,.:;"\'’]|\*\*', '', s.lower())
    s = re.sub(r'[^a-z0-9؀-ۿ]+', '-', s).strip('-')
    return s[:40].rstrip('-')


def sections():
    """Leaf sections: (key, heading, start line, end line, text). Part number + heading number or slug."""
    L = open(BS, encoding='utf-8').read().split('\n')
    heads = []
    fence = False
    for i, l in enumerate(L):
        if l.startswith('```'): fence = not fence
        m = None if fence else re.match(r'(#{2,6}) (.*)', l)
        if m: heads.append((i, len(m.group(1)), m.group(2).strip()))
    out = []
    part = ''
    stack = []
    for n, (i, lvl, title) in enumerate(heads):
        if lvl == 2:
            mm = re.match(r'Part (\d)', title)
            part = 'P' + mm.group(1) if mm else ''
            stack = []
            continue
        stack = [s for s in stack if s[0] < lvl] + [(lvl, title)]
        lvl_of = lambda t, st: next(l for l, x in st if x == t)
        nxt = heads[n + 1][1] if n + 1 < len(heads) else 0
        end = heads[n + 1][0] if n + 1 < len(heads) else len(L)
        is_leaf = not (nxt > lvl)
        body = '\n'.join(L[i + 1:end]).strip(' \n-')
        if not is_leaf and not body.strip():
            continue
        parts = []
        for _, t in stack:
            m = re.match(r'(\d+(?:\.\d+)+|\d+(?=\.? ))\.? ', t)
            if m and lvl_of(t, stack) > 3 and '.' not in m.group(1): m = None
            parts.append(m.group(1) if m else slug(t))
        # number-only keys when the heading itself is numbered; otherwise number of nearest numbered parent + slug
        key = part + '/' + '/'.join(parts[-2:]) if not re.fullmatch(r'\d+(?:\.\d+)*', parts[-1]) else part + '/' + parts[-1]
        out.append((key, title, i + 1, end, '\n'.join(L[i:end])))
    return out


def spec_files():
    return sorted(glob.glob(SPECS + '/**/spec.md', recursive=True))


def source_keys(text):
    m = re.search(r'^\*\*Sources\*\*:(.*(?:\n(?:- |  ).*)*)', text, re.M)
    return set(re.findall(r'`([^`]+)`', m.group(1))) if m else set()


def lint():
    bad = []
    ids = collections.Counter()
    for f in spec_files():
        t = open(f, encoding='utf-8').read()
        rel = os.path.relpath(f, SPECS)
        folder = os.path.basename(os.path.dirname(f))
        if not re.match(r'\d{3}-[a-z0-9-]+$', folder): bad.append(f'{rel}: folder must be NNN-kebab-slug')
        if not re.match(r'# Feature Specification: \S', t): bad.append(f'{rel}: missing "# Feature Specification:" title')
        m = re.search(r'^\*\*Feature ID\*\*: ([A-Z]{2,3}-\d{3})$', t, re.M)
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
    sys.exit(1 if bad else 0)


MODULES = dict(CFG['modules'])


def readme():
    """Regenerate the block between the feature markers in specs/README.md."""
    rows = []
    for f in spec_files():
        rel = os.path.relpath(f, SPECS).split(os.sep)
        mod = rel[0]
        t = open(f, encoding='utf-8').read()
        title = re.match(r'# Feature Specification: (.*)', t).group(1).strip()
        fid = re.search(r'\*\*Feature ID\*\*: (\S+)', t).group(1)
        rows.append((mod, rel[:-1], fid, title, '/'.join(rel)))
    out = ['<!-- features:start -->', '', '## Features by module', '']
    for mod in list(MODULES) + sorted({r[0] for r in rows if r[0] not in MODULES}):
        mine = [r for r in rows if r[0] == mod]
        if not mine: continue
        out += [f'### [{mod}]({mod}/README.md) — {MODULES.get(mod, mod.upper())}', '', '| ID | Feature |', '| --- | --- |']
        out += [f'| {fid} | [{title}]({path}) |' for _, _, fid, title, path in sorted(mine, key=lambda r: r[4])]
        out.append('')
    out.append('<!-- features:end -->')
    p = os.path.join(SPECS, 'README.md')
    t = open(p, encoding='utf-8').read()
    block = '\n'.join(out)
    t = re.sub(r'<!-- features:start -->.*<!-- features:end -->', lambda m: block, t, flags=re.S)
    open(p, 'w', encoding='utf-8').write(t)
    print(f'readme: {len(rows)} features')


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'verify'
    secs = sections()
    all_keys = {x[0] for x in secs}
    if '--only' in sys.argv:
        only = {l.split('\t')[0].strip() for l in open(sys.argv[sys.argv.index('--only') + 1]) if l.strip()}
        secs = [s for s in secs if s[0] in only]
    keys = [s[0] for s in secs]
    dup = [k for k, c in collections.Counter(keys).items() if c > 1]
    if cmd == 'lint': lint()
    if cmd == 'readme': readme(); return
    if cmd == 'index':
        for k, t, a, b, _ in secs:
            print(f'{k}\t{a}-{b}\t{t}')
        if dup: print('DUPLICATE KEYS', dup, file=sys.stderr)
        return
    files = spec_files()
    texts = {f: open(f, encoding='utf-8').read() for f in files}
    claimed = collections.defaultdict(list)
    for f, t in texts.items():
        for k in source_keys(t): claimed[k].append(f)
    corpus = norm(' '.join(texts.values()))
    problems = []
    if dup: problems.append(f'duplicate section keys: {dup}')
    unknown = [k for k in claimed if k not in all_keys]
    for k in unknown: problems.append(f'unknown source key {k} in {[os.path.relpath(x, SPECS) for x in claimed[k]]}')
    for k, t, a, b, body in secs:
        if k not in claimed:
            problems.append(f'UNCLAIMED section {k} (lines {a}-{b}) {t}'); continue
        mapped = norm(' '.join(texts[f] for f in claimed[k]))
        mapped_ids = set(ID_RE.findall(' '.join(texts[f] for f in claimed[k])))
        for i in sorted(set(ID_RE.findall(body))):
            if not re.search(r'(?<![A-Za-z0-9-])' + re.escape(i) + r'(?![A-Za-z0-9-])', ' '.join(texts[f] for f in claimed[k])):
                problems.append(f'{k}: ID {i} missing from mapped specs')
        for u in sorted(set(UNIT_RE.findall(body))):
            if norm(u) not in mapped and norm(u).replace(' ', '') not in mapped.replace(' ', ''):
                problems.append(f'{k}: value "{u}" missing from mapped specs')
        for q in sorted(set(QUOTE_RE.findall(body))):
            if norm(q) not in mapped:
                problems.append(f'{k}: quoted text "{q[:60]}" missing from mapped specs')
    print(f'{len(files)} specs, {len(secs)} sections, {len(problems)} problems')
    for p in problems: print(p)
    sys.exit(1 if problems else 0)


main()
