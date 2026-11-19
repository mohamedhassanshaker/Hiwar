#!/usr/bin/env python3
"""End-to-end coverage of the acceptance scenarios of completed feature specs.

  e2e_coverage.py plan [ID...]                     every acceptance scenario of the completed specs (or of ID...),
                                                   with its text and the e2e tests whose titles cite it
  e2e_coverage.py verify [ID...] [--report FILE]   exit 1 unless every scenario is cited by a test title; with a
                                                   Playwright JSON report, also unless each citing test passed

A test cites scenarios by ID in its title: `AC-INB-002-03: ...`. Shorthand continues the last full ID:
`AC-KNO-001-04, -05` and `AC-ORG-004-01 to -04`. Test directory: `e2e.test_dir` in .claude/xyz.json.
"""
import glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'xyz-docs', 'scripts'))
import xyz_config  # noqa: E402
import specs_board  # noqa: E402

CFG = xyz_config.load()
E2E = dict(xyz_config.DEFAULTS['e2e'], **(CFG.get('e2e') or {}))
TEST_DIR = os.path.join(CFG['root'], E2E['test_dir'])
AC_LINE = re.compile(r'^\s*\d+\.\s+\*\*(AC-[A-Za-z0-9-]+-\d+)\*\*\s*[—:-]?\s*(.*)$', re.M)
TITLE = re.compile(r'''\btest(?:\.(?:only|fixme|skip|fail))?\(\s*(["'`])((?:\\.|(?!\1).)*)\1''', re.S)
CITE = re.compile(r'(AC-[A-Za-z0-9-]*[A-Za-z0-9])-(\d+)(?![\w-])|(,\s*|\s+to\s+)-(\d+)(?![\w-])')


def cited(title):
    """AC IDs a test title cites, with shorthand expanded."""
    out, base, last = [], None, None
    for m in CITE.finditer(title):
        if m.group(1):
            base, last = m.group(1), m.group(2)
            out.append(f'{base}-{last}')
        elif base:
            n = m.group(4)
            if 'to' in m.group(3):
                out += [f'{base}-{i:0{len(n)}d}' for i in range(int(last) + 1, int(n) + 1)]
            else:
                out.append(f'{base}-{n}')
            last = n
    return out


def scenarios(ids):
    """{spec ID: [(AC ID, text)]} for the completed specs, or for ids."""
    done = specs_board.read_rows(specs_board.DONE)
    sp = specs_board.specs()
    want = ids or sorted(done)
    missing = [i for i in want if i not in sp]
    if missing: sys.exit(f'unknown spec IDs: {missing}')
    out = {}
    for i in want:
        t = open(os.path.join(specs_board.SPECS, sp[i]['path']), encoding='utf-8').read()
        out[i] = [(a, re.sub(r'\*\*', '', txt).strip()) for a, txt in AC_LINE.findall(t)]
    return out


def tests():
    """{AC ID: [(file, title)]} from the test sources."""
    by_ac = {}
    for f in sorted(glob.glob(TEST_DIR + '/**/*.spec.[jt]s', recursive=True)):
        for m in TITLE.finditer(open(f, encoding='utf-8').read()):
            for a in cited(m.group(2)):
                by_ac.setdefault(a, []).append((os.path.relpath(f, CFG['root']).replace(os.sep, '/'), m.group(2)))
    return by_ac


def report_results(path):
    """{title: [status, ...]} from a Playwright JSON report; status per test run of that title."""
    res = {}

    def walk(suite):
        for s in suite.get('specs', []):
            for t in s.get('tests', []):
                res.setdefault(s['title'], []).append(t.get('status', 'unexpected'))
        for c in suite.get('suites', []): walk(c)
    for s in json.load(open(path, encoding='utf-8')).get('suites', []): walk(s)
    return res


def main():
    a = sys.argv[1:]
    cmd = a[0] if a else ''
    report = a[a.index('--report') + 1] if '--report' in a else None
    ids = [x for x in a[1:] if re.fullmatch(r'[A-Z]{2,3}-\d{3}', x)]
    if cmd not in ('plan', 'verify'): print(__doc__); return 2
    sc, by_ac = scenarios(ids), tests()
    if cmd == 'plan':
        for i, acs in sc.items():
            print(f'## {i}')
            for ac, txt in acs:
                where = '; '.join(f'{f}: {t}' for f, t in by_ac.get(ac, [])) or 'NO TEST'
                print(f'- {ac}: {txt}\n  tests: {where}')
        return 0
    res = report_results(report) if report else None
    bad, total = [], 0
    for i, acs in sc.items():
        if not acs: bad.append(f'{i}: spec has no acceptance scenarios')
        for ac, _ in acs:
            total += 1
            ts = by_ac.get(ac)
            if not ts: bad.append(f'{i}: {ac} has no test'); continue
            if res is None: continue
            st = [s for _, t in ts for s in res.get(t, ['not run'])]
            if 'unexpected' in st: bad.append(f'{i}: {ac} failed')
            elif 'flaky' in st: bad.append(f'{i}: {ac} flaky (passed only on retry)')
            elif 'expected' not in st: bad.append(f'{i}: {ac} not run or skipped ({", ".join(sorted(set(st)))})')
    print(f'e2e: {len(sc)} specs, {total} scenarios, {len(bad)} problems' + ('' if report else ' (no report: citations only)'))
    for b in bad: print(b)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
