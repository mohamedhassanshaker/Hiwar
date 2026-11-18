#!/usr/bin/env python3
"""Delete one functional requirement from a spec and keep every reference consistent.

  remove_fr.py FEATURE-ID FR-nnn [--to FR-mmm]

Later FRs of that spec are renumbered; references `FEATURE-ID FR-nnn` in specs and ledgers are renumbered, and references to the
removed FR move to --to (given as the number before renumbering). Without --to, remaining references are listed and nothing is written.
"""
import sys, re, os, glob

import xyz_config

SPECS = xyz_config.load()['specs_dir_abs']


def main(fid, fr, to):
    spec = next((f for f in glob.glob(SPECS + '/**/spec.md', recursive=True) if re.search(r'^\*\*Feature ID\*\*: ' + re.escape(fid) + r'$', open(f, encoding='utf-8').read(), re.M)), None)
    if not spec: sys.exit(f'unknown feature {fid}')
    n = int(fr.split('-')[1]); m_to = int(to.split('-')[1]) if to else None
    if m_to == n: sys.exit('--to must differ from the removed FR')
    files = glob.glob(SPECS + '/**/*.md', recursive=True)
    if not to:
        refs = [f for f in files if f != spec and re.search(re.escape(fid) + r' ' + re.escape(fr) + r'\b', open(f, encoding='utf-8').read())]
        if refs: sys.exit('still referenced (use --to): ' + ', '.join(os.path.relpath(r, SPECS) for r in refs))

    def remap(k):
        if k == n and m_to is not None: k = m_to
        return k - 1 if k > n else k

    # the spec itself: drop the FR block, renumber own labels and unprefixed or same-prefixed references
    lines = open(spec, encoding='utf-8').read().split('\n')
    out, skip = [], False
    for l in lines:
        if re.match(r'- \*\*FR-%03d\*\*' % n, l): skip = True; continue
        if skip and (l.strip() == '' or l.startswith(('- ', '#'))): skip = False
        if skip: continue
        out.append(l)
    text = '\n'.join(out)

    def own(m):
        pre, k = m.group(1) or '', int(m.group(3))
        if pre and pre.strip() != fid: return m.group(0)
        return f'{pre}FR-{remap(k):03d}'
    text = re.sub(r'((?:[A-Z]{2,3}-\d{3} )?)(\*\*)?FR-(\d+)', lambda m: (m.group(1) or '') + ('**' if m.group(2) else '') + (f'FR-{remap(int(m.group(3))):03d}' if (not m.group(1) or m.group(1).strip() == fid) else f'FR-{m.group(3)}'), text)
    open(spec, 'w', encoding='utf-8').write(text)
    pat = re.compile(re.escape(fid) + r' FR-(\d+)')
    for f in files:
        if f == spec: continue
        t = open(f, encoding='utf-8').read()
        t2 = pat.sub(lambda m: f'{fid} FR-{remap(int(m.group(1))):03d}', t)
        if t2 != t: open(f, 'w', encoding='utf-8').write(t2)
    print(f'removed {fid} {fr}')


if __name__ == '__main__':
    a = sys.argv[1:]
    to = a[a.index('--to') + 1] if '--to' in a else None
    if len(a) < 2: sys.exit(__doc__)
    main(a[0], a[1], to)
