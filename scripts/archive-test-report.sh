#!/usr/bin/env bash
# Stores one test run as `docs/09-testing/reports/<YYYYMMDD>/`, beside every earlier run. A later run
# of a day already filed is `<YYYYMMDD>_1`, then `_2`, and so on: no run replaces another.
#
#   scripts/archive-test-report.sh <run folder> [YYYYMMDD]
#
# `docs/09-testing/reports/index.html` lists every run with its Playwright HTML reports (every test,
# its result, screenshots, page snapshot and the trace of every result that did not pass) and
# their counts; browse it with `python -m http.server -d docs/09-testing/reports`. The run's
# `report.md` is also copied to `<name>.md`, the only file of a run that is committed.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_dir="${1:?usage: archive-test-report.sh <run folder> [YYYYMMDD]}"
day="${2:-$(date -u +%Y%m%d)}"
out_dir="${root}/docs/09-testing/reports"

[ -f "${run_dir}/report.md" ] || { echo "${run_dir}/report.md is missing." >&2; exit 2; }
[[ "${day}" =~ ^[0-9]{8}$ ]] || { echo "The day must be YYYYMMDD, not '${day}'." >&2; exit 2; }
for suite in e2e-results.json:e2e-html live/results.json:live/live-report; do
  if [ -f "${run_dir}/${suite%%:*}" ] && [ ! -f "${run_dir}/${suite#*:}/index.html" ]; then
    echo "${run_dir}/${suite#*:}/index.html is missing: the run has ${suite%%:*} but not its HTML report." >&2
    exit 2
  fi
done

mkdir -p "${out_dir}"
name="${day}"
for ((n = 1; ; n++)); do
  [ -e "${out_dir}/${name}" ] || [ -e "${out_dir}/${name}.md" ] || break
  name="${day}_${n}"
done
# Windows without LongPathsEnabled opens no path of 260 characters or more, so a run that
# would hold one is refused rather than filed with files nobody can open.
python -I - "${run_dir}" "${out_dir}/${name}" <<'EOF'
import os, sys
from pathlib import Path

run_dir, run = Path(sys.argv[1]), Path(sys.argv[2]).resolve()
too_long = [p for p in run_dir.rglob("*") if len(str(run / p.relative_to(run_dir))) >= 260]
if os.name == "nt" and too_long:
    sys.exit(f"{len(too_long)} paths would be 260 characters or more under {run}, such as "
             f"{too_long[0].relative_to(run_dir)}. Shorten the folder names in the run folder.")
EOF

# `cp`, not Python: a run folder deeper than its archive can hold paths Python cannot open.
cp -R "${run_dir}" "${out_dir}/${name}"

python -I - "${out_dir}" "${name}" <<'EOF'
import hashlib, html, json, re, shutil, sys
from pathlib import Path

out_dir, day = Path(sys.argv[1]).resolve(), sys.argv[2]
run = out_dir / day
SUITES = [("e2e", "e2e-results.json", "e2e-html"), ("live", "live/results.json", "live/live-report")]


def tests(report):
    def walk(suite):
        for spec in suite.get("specs", []):
            yield from spec["tests"]
        for child in suite.get("suites", []):
            yield from walk(child)
    for suite in report["suites"]:
        yield from walk(suite)


# The live suite traces every test (`trace: "on"`); the archive keeps the traces of results
# that did not pass, in the HTML report only. Playwright 1.64's HTML reporter stores an
# attachment as `data/<sha1 of the file><ext>` (lib/runner/index.js, `_serializeAttachments`),
# so a trace is found in the report by hashing its copy in `live/test-results`. If the naming
# changes, traces are counted as not found and kept. A passed result's folder in
# `live/test-results` is dropped too: the report holds its screenshots and logs.
if (run / "live/results.json").is_file():
    report = json.loads((run / "live/results.json").read_text(encoding="utf-8"))
    output_dirs = {p["name"]: Path(p["outputDir"]) for p in report["config"]["projects"]}
    data, copies = run / "live/live-report/data", run / "live/test-results"
    kept = dropped = not_found = 0
    passed_dirs = set()
    for test in tests(report):
        for result in test["results"]:
            for attachment in result["attachments"]:
                if "path" not in attachment:
                    continue
                copy = copies / Path(attachment["path"]).relative_to(output_dirs[test["projectName"]])
                if result["status"] == "passed":
                    passed_dirs.add(copy.relative_to(copies).parts[0])
                if attachment["name"] != "trace":
                    continue
                in_report = data / (hashlib.sha1(copy.read_bytes()).hexdigest() + copy.suffix) if copy.is_file() else None
                if in_report is None or not in_report.is_file():
                    not_found += 1
                elif result["status"] == "passed":
                    in_report.unlink()
                    dropped += 1
                else:
                    copy.unlink()
                    kept += 1
    for name in passed_dirs:
        shutil.rmtree(copies / name)
    print(f"live traces: {kept} kept (did not pass), {dropped} dropped (passed), {not_found} not found in the report (left as they are)")


def counts(report_file):
    stats = json.loads(report_file.read_text(encoding="utf-8"))["stats"]
    return (f"{stats['expected']} passed, {stats['unexpected']} failed, {stats['flaky']} flaky, "
            f"{stats['skipped']} skipped, {stats['duration'] / 60000:.0f} min")


rows = []
# Newest first: by day, then by the run's number within the day (`_10` after `_9`).
runs = [p for p in out_dir.iterdir() if p.is_dir() and re.fullmatch(r"\d{8}(_\d+)?", p.name)]
for past in sorted(runs, key=lambda p: (p.name[:8], int(p.name[9:] or 0)), reverse=True):
    title = (past / "report.md").read_text(encoding="utf-8").splitlines()[0].removeprefix("# ")
    links = [f'<a href="{past.name}/report.md">report.md</a>']
    for name, results, html_dir in SUITES:
        if (past / results).is_file():
            label = f'<a href="{past.name}/{html_dir}/index.html">{name}</a>' if (past / html_dir / "index.html").is_file() else name
            links.append(f"{label}: {counts(past / results)}")
    rows.append(f"<li><b>{past.name}</b> {html.escape(title)}<br>{'<br>'.join(links)}</li>")

(out_dir / "index.html").write_text(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test report history</title>
<style>body {{ font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }} li {{ margin-bottom: 1rem; }}</style>
</head><body>
<h1>Test report history</h1>
<p>The trace viewer works only over HTTP: run <code>python -m http.server -d docs/09-testing/reports</code>
and open <a href="http://localhost:8000/">http://localhost:8000/</a>.</p>
<ul>
{chr(10).join(rows)}
</ul>
</body></html>
""", encoding="utf-8")
print(f"{run}: {sum(f.stat().st_size for f in run.rglob('*') if f.is_file()) / 1e6:.0f} MB")
EOF

cp "${run_dir}/report.md" "${out_dir}/${name}.md"
echo "Filed as ${out_dir}/${name}"
