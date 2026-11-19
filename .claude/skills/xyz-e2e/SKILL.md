---
name: xyz-e2e
description: Write and run a real end-to-end Playwright suite that proves every acceptance scenario of the completed feature specs (or of given spec IDs, including pending specs just implemented by xyz-implement) against the running application, then record the result in the spec board (evidence for passing specs, reopen for failing ones). Use when asked to write, extend, run or audit e2e or acceptance tests for completed specs, to prove that completed specs work, or to check which acceptance scenarios have no passing e2e test.
---

# End-to-end tests for completed specs

A spec in `specs-completed.md` (see the `xyz-docs` skill) claims that every acceptance scenario in it works. This skill proves the claim: every `AC-*` scenario of every completed spec has a Playwright test that drives the real application the way its users do, and the test passes against a running deployment.

The check is `e2e_coverage.py`; it reads the spec board and specs through the `xyz-docs` scripts, so both skills must be installed.

| Command (from the project root) | Effect |
| --- | --- |
| `python .claude/skills/xyz-e2e/scripts/e2e_coverage.py plan [ID...]` | Every scenario of the completed specs (or of the given specs): ID, Given/When/Then text, and the tests whose titles cite it, or `NO TEST` |
| `python .claude/skills/xyz-e2e/scripts/e2e_coverage.py verify [ID...] [--report FILE]` | Every scenario is cited by a test title; with a Playwright JSON report, every citing test passed, was not skipped and did not pass only on retry |
| `python .claude/skills/xyz-docs/scripts/specs_board.py evidence ID... --evidence "..."` | Replaces the date and evidence of completed specs |
| `python .claude/skills/xyz-docs/scripts/specs_board.py reopen ID...` | Moves specs whose scenarios fail back to the backlog |

Configuration: `e2e` in `.claude/xyz.json`, `{"test_dir": "tests/e2e", "run": "<command that runs the suite and passes extra arguments to Playwright>"}`.

## Before writing

1. Read the project's test conventions (for example `docs/07-testing/`), `playwright.config.*`, the existing tests and helpers in `test_dir`, the declared run command (Makefile, `package.json`, `scripts/`), and the local stand-ins the project defines for external systems (mail catcher, model stub, payment mock).
2. Bring up the deployment the run command targets, under the resource limits and memory watch the project's `CLAUDE.md` requires. Confirm it is healthy before writing tests against it.
3. `e2e_coverage.py plan` and read each spec in full, not only its scenarios: the FRs give the exact messages, limits and states the assertions must check.
4. Open the screens with the `playwright-cli` skill and walk each scenario by hand to learn the roles, labels and flows. A scenario that cannot be walked because the behaviour is missing is a product defect, not a test to write around.

## Writing tests

- **Layout.** One file per spec: `<test_dir>/<module>/<FEATURE-ID>.spec.ts` with `test.describe('<FEATURE-ID> <feature name>')`. Shared steps (sign-up, sign-in, reading a mail link, creating an agent or deployment) go in `<test_dir>/support/` and are reused; move helpers out of existing files when a second file needs them.
- **Titles.** Each test title starts with the AC IDs it proves, then the outcome: `AC-INB-002-03: a second claimer sees "Khalid already claimed this"`. One scenario per test is the default; one test may cite several scenarios only when they are steps of one flow. Shorthand `AC-X-001-04, -05` and `AC-X-001-01 to -04` is understood.
- **Real application.** Drive the product through its UI, and through its public HTTP routes (`request` fixture) only where the scenario's actor is a machine (widget, webhook, API client). Do not mock the application's own routes with `page.route`, write to its database, or call internal endpoints to set up state. External systems use the stand-ins the project's environment defines.
- **Isolation.** Each test or file creates its own organization, users and data with a unique run suffix, so tests run in any order and against a deployment that already holds data. Use `test.describe.configure({ mode: 'serial' })` only inside one file for steps of one flow.
- **Assertions.** Assert the scenario's **Then** exactly: visible text and messages copied from the spec, states, counts, values with units, URL. Use role, label and text locators and web-first `expect` assertions; no fixed waits, no CSS or XPath tied to layout. Assert what must not happen when the spec says so (no AI reply, no second owner, no delivery).
- **Several actors.** Use one browser context per actor (staff, second staff, visitor, operator) to test ownership races, live updates and permissions.
- **Time, races and limits.** Use `page.clock` for client-side time. For server-side durations and quotas, drive the product's own configuration (a deployment quota, a session length) to small values through its UI when the spec allows configuring them. For races, fire the competing actions together with `Promise.all`.
- **Cannot be driven end to end.** When a scenario depends on something the product gives no user-facing way to reach (a 7-day grace period with no configurable clock), write `test.fixme('AC-...: <outcome> (needs <what>)', ...)`. `verify` keeps reporting it; report it to the owner with what would make it testable. Do not count a unit test as e2e evidence.

## Running

Run with a JSON report so `verify` can read the results:

```
PLAYWRIGHT_JSON_OUTPUT_NAME=<scratchpad>/e2e.json <e2e.run> --reporter=list,json
python .claude/skills/xyz-e2e/scripts/e2e_coverage.py verify --report <scratchpad>/e2e.json
```

Run one spec while writing it: `<e2e.run> --grep <FEATURE-ID>`. Run the whole suite before recording results. Do not add retries to make a run pass; `verify` treats a pass on retry as flaky.

## Failures

For each failing test, use the `debugging-research` skill and establish which side is wrong by reading the spec, the trace (`trace: 'retain-on-failure'`), the console and network logs, and the logs of every service involved.

| Cause | Action |
| --- | --- |
| The test is wrong (locator, setup, timing, a wrong reading of the spec) | Fix the test. Never weaken an assertion so that behaviour the spec forbids passes |
| The product does not do what the spec says, and the fix is clear and within the spec | Fix the product, add or update its unit tests, rerun |
| The product does not do what the spec says, and the fix is not clear or not small | `specs_board.py reopen <ID>`; list the failing scenarios and the cause in the report |
| The spec is ambiguous or contradicts its source | Leave the test failing or `fixme`, raise an open question (`xyz-docs`), report it |
| Flaky | Run it alone with `--repeat-each=5`; find the race in the test or the product and fix it |

## Recording results

1. `e2e_coverage.py verify --report ...` for the specs in scope must print `0 problems`.
2. For each spec whose scenarios all pass: if it is completed, `specs_board.py evidence <ID> --evidence "<test file> (Playwright, <n> scenarios passed, <date>, against <deployment>)"`; if it is pending (given by ID, for example from `xyz-implement --e2e`), `specs_board.py complete <ID> --evidence "..."` with the same text.
3. A pending spec with a failing scenario stays pending. Specs reopened in this run stay in the backlog until a later run passes; then `specs_board.py complete` with the same kind of evidence.
4. Report: scenarios covered and passed, specs reopened with their failing scenarios, `fixme` scenarios with what they need, and product fixes made. Stop the deployment, port-forwards and browsers you started.
