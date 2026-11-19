#!/usr/bin/env python3
"""Append one functional requirement to a feature spec (locked, auto-numbered).

  add_fr.py FEATURE-ID "System MUST ... [UI:Screen]"   prints `FEATURE-ID FR-nnn`
"""
import sys, re, os, glob

import xyz_config

SPECS = xyz_config.load()['specs_dir_abs']


def main(fid, text):
    path = next((f for f in glob.glob(SPECS + '/**/spec.md', recursive=True) if re.search(r'^\*\*Feature ID\*\*: ' + re.escape(fid) + r'$', open(f, encoding='utf-8').read(), re.M)), None)
    if not path: sys.exit(f'unknown feature {fid}')
    if not re.match(r'^(System|Users?|[A-Z][a-z]+) (MUST|MAY|SHOULD)\b', text): sys.exit('text must start with a subject and MUST/MAY/SHOULD')
    with open(path, 'r+', encoding='utf-8', newline='') as fh, xyz_config.locked(fh):
        lines = fh.read().split('\n')
        start = next(i for i, l in enumerate(lines) if l.startswith('### Functional Requirements'))
        end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith(('### ', '## '))), len(lines))
        last = max((i for i in range(start, end) if re.match(r'- \*\*FR-\d+\*\*', lines[i])), default=None)
        if last is None: sys.exit('no FRs in spec')
        n = int(re.match(r'- \*\*FR-(\d+)\*\*', lines[last]).group(1)) + 1
        while last + 1 < end and lines[last + 1].strip() and not lines[last + 1].startswith('- **FR-'): last += 1
        lines.insert(last + 1, f'- **FR-{n:03d}**: {text}')
        fh.seek(0); fh.write('\n'.join(lines)); fh.truncate()
    print(f'{fid} FR-{n:03d}')


if __name__ == '__main__':
    if len(sys.argv) != 3: sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
