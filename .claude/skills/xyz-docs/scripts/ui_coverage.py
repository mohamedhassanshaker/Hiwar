#!/usr/bin/env python3
"""UI coverage of design artboards (*.dc.html) by feature specs, through per-screen ledgers.

  ui_coverage.py extract [BOARDS [Screen]]   print the UI items found in the artboards (JSON)
  ui_coverage.py verify [BOARDS]             exit 1 unless every UI item has a ledger row that resolves to a spec requirement

BOARDS is a folder or a .zip holding `*.dc.html` artboards (zip members are read in memory, not extracted);
default: design_boards in .claude/xyz.json.

Ledger: <specs_dir>/ui-coverage/<Screen>.md, rows `| UI function | Kind | Covered by |`.
Covered by: `<FEATURE-ID> FR-nnn` or `<FEATURE-ID> AC-...` (must exist), or `n/a: <sample data|layout|decoration|prototype state|duplicate of ...|removed from scope>`.
"""
import re, sys, os, glob, json, html, zipfile

import xyz_config

CFG = xyz_config.load()
ROOT = CFG['root']
SPECS = CFG['specs_dir_abs']
LEDGERS = os.path.join(SPECS, 'ui-coverage')


def clean(s):
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s))
    s = re.sub(r'\{\{[^}]*\}\}', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def norm(s):
    s = html.unescape(s).replace('’', "'").replace('“', '"').replace('”', '"').replace('\\', '')
    return re.sub(r'\s+', ' ', re.sub(r'[`*]', '', s)).strip().lower()


def extract(t):
    parts = t.split('</x-dc>')
    tpl = re.sub(r'<style.*?</style>', '', parts[0], flags=re.S)
    scr = parts[1] if len(parts) > 1 else ''
    items = {}

    def add(k, x):
        x = x.strip()
        if 2 <= len(x) <= 140 and re.search(r'[A-Za-z؀-ۿ]{2}', x): items.setdefault((k, x), 0)
    for m in re.finditer(r'<(button|a)\b[^>]*>(.*?)</\1>', tpl, re.S): add('action', clean(m.group(2)))
    for m in re.finditer(r'(?:aria-label|placeholder)="([^"{]+)"', tpl): add('control', html.unescape(m.group(1)))
    for m in re.finditer(r'<label\b[^>]*>(.*?)</label>', tpl, re.S): add('field', clean(m.group(1)))
    for m in re.finditer(r'<(h1|h2|h3)\b[^>]*>(.*?)</\1>', tpl, re.S): add('heading', clean(m.group(2)))
    for m in re.finditer(r'class="[^"]*\b(?:card-t|tab)\b[^"]*"[^>]*>([^<{]+)<', tpl): add('heading', clean(m.group(1)))
    for m in re.finditer(r"this\.say\(\s*(?:'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"|`([^`]*)`)", scr):
        add('outcome', (m.group(1) or m.group(2) or m.group(3) or '').replace("\\'", "'"))
    for m in re.finditer(r"\bh:\s*(?:'((?:[^'\\]|\\.)*)'|\"([^\"]*)\")", scr): add('dialog', (m.group(1) or m.group(2) or '').replace("\\'", "'"))
    for m in re.finditer(r"\b(?:c|cta|label|l|lbl|btn)\s*:\s*'((?:[^'\\]|\\.){2,50})'", scr): add('label', m.group(1).replace("\\'", "'"))
    for m in re.finditer(r"(?:const|let|var)\s+(?:TB|TABS|TB\d|SC|FL|SEG|OPTS|MENU|TABS\w*)\s*=\s*\[(.*?)\];", scr, re.S):
        for s in re.findall(r"'((?:[^'\\]|\\.){2,50})'", m.group(1)): add('option', s)
    for m in re.finditer(r'"(k[A-Za-z0-9]+)":\s*"((?:[^"\\]|\\.)*)"', scr):
        x = m.group(2).replace('\\"', '"')
        if re.search(r'[A-Za-z]{2}', x): add('text', x)
    return [{'kind': k, 'text': x} for (k, x) in items]


def artboards(d):
    """Screen name -> artboard text, from a folder or a zip."""
    if zipfile.is_zipfile(d):
        with zipfile.ZipFile(d) as z:
            return {os.path.basename(n)[:-8]: z.read(n).decode('utf-8') for n in sorted(z.namelist()) if n.endswith('.dc.html')}
    return {os.path.basename(f)[:-8]: open(f, encoding='utf-8').read() for f in sorted(glob.glob(os.path.join(d, '*.dc.html')))}


def spec_index():
    ids = {}
    for f in glob.glob(SPECS + '/**/spec.md', recursive=True):
        t = open(f, encoding='utf-8').read()
        m = re.search(r'\*\*Feature ID\*\*: (\S+)', t)
        if not m: continue
        ids[m.group(1)] = (set(re.findall(r'^- \*\*(FR-\d+)\*\*', t, re.M)), t)
    return ids


def verify(d):
    ab = artboards(d)
    ids = spec_index()
    problems = []
    rows_total = 0
    for name, t in ab.items():
        items = extract(t)
        if not items: continue
        lp = os.path.join(LEDGERS, name + '.md')
        if not os.path.exists(lp):
            problems.append(f'{name}: no ledger ({len(items)} UI items)'); continue
        led = open(lp, encoding='utf-8').read()
        rows = [[c.strip() for c in l.strip().strip('|').split('|')] for l in led.split('\n') if l.startswith('|') and not re.match(r'\|\s*[-:]', l) and 'UI function' not in l]
        rows_total += len(rows)
        ln = norm(' '.join(r[0] for r in rows if r))
        for it in items:
            if norm(it['text']) not in ln: problems.append(f'{name}: no ledger row for {it["kind"]} "{it["text"][:70]}"')
        for r in rows:
            if len(r) < 3: problems.append(f'{name}: malformed row {r[:1]}'); continue
            cov = r[2]
            if cov.lower().startswith('n/a'):
                if not re.match(r'n/a: (sample data|layout|decoration|prototype state|duplicate of .+|design token|removed from scope|navigation to \S.*)$', cov, re.I): problems.append(f'{name}: bad n/a reason "{cov[:60]}"')
                continue
            refs = re.findall(r'([A-Z]{2,3}-\d{3}) (FR-\d+|AC-[A-Za-z0-9-]+)', cov)
            if not refs: problems.append(f'{name}: row "{r[0][:50]}" has no spec reference'); continue
            for fid, ref in refs:
                if fid not in ids: problems.append(f'{name}: unknown feature {fid}')
                elif ref.startswith('FR-') and ref not in ids[fid][0]: problems.append(f'{name}: {fid} has no {ref}')
                elif ref.startswith('AC-') and ref not in ids[fid][1]: problems.append(f'{name}: {fid} has no {ref}')
    print(f'ui: {len(ab)} artboards, {rows_total} ledger rows, {len(problems)} problems')
    for p in problems: print(p)
    return 1 if problems else 0


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    src = sys.argv[2] if len(sys.argv) > 2 else (CFG.get('design_boards') and os.path.join(ROOT, CFG['design_boards']))
    if cmd in ('extract', 'verify') and not src: sys.exit('give BOARDS or set design_boards in .claude/xyz.json')
    if cmd == 'extract':
        ab = artboards(src)
        sel = sys.argv[3] if len(sys.argv) > 3 else None
        print(json.dumps({n: extract(t) for n, t in ab.items() if not sel or n == sel}, indent=1, ensure_ascii=False))
    elif cmd == 'verify':
        sys.exit(verify(src))
    else:
        print(__doc__)
