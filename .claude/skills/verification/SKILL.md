---
name: verification
description: Verification rules for finishing a change. Use before running tests or CI checks, before claiming work is done or verified, when a check fails, and when adding or changing tests or CI workflows.
---

# Verification

- Design verification alongside the system. Define the behaviours and invariants to qualify, realistic stimuli and
  failure conditions, independently derived expected outcomes, observation points, and pass/fail criteria. Exercise the
  relevant component interactions. Extend the existing testing strategy for the change; build fixtures, drivers, fault
  injection, or harnesses only where needed to exercise or observe a specific behaviour that existing tools cannot
  verify. This does not require a separate plan or testing framework.
- A change that passes local verification must not fail in GitHub Actions; prevent such failure by design. Run the same
  verification entry point locally and in CI; GitHub Actions calls it rather than reimplementing checks. Use the same
  declared runtimes, package manager, verification tools, and lock-file resolutions for equivalent jobs. Declare each
  version once, update shared local/CI declarations together, and inspect effective versions with existing tools. Keep
  unrelated upgrades outside the task. Reproduce discrepancies at the same revision with relevant environment state; use
  clean installs to expose undeclared local dependencies and retain cache/state needed to reproduce state-dependent
  failures. Fix the mismatch rather than relaxing a check. Declare live or environment-specific checks separately.
- Run relevant existing checks and all checks required for the operation. Never weaken, skip, or mock away a required
  check to obtain green output. Add no lint or type suppressions or global rule ignores unless a dependency makes the
  fix impossible; then state the evidence in a one-line comment beside it. A required check with a missing tool or empty
  test corpus has not passed. Preserve exit status and wait for running checks to finish; do not infer success from
  truncated logs or kill a valid run to save time.
- Choose the least costly sufficient check within the existing testing strategy; inspection or an existing check may
  suffice. Every added test must detect a meaningful failure or qualify a behaviour existing tests miss. Test observable
  contracts and effects; do not mirror implementation details, calculate expectations with the logic under test, or add
  trivial assertions for test counts or coverage. Focused unit tests are useful for substantive contracts and
  algorithms. Copy, comment, and formatting edits normally need inspection or existing checks; test exact text only when
  it is a required contract.
- Select checks that establish the claim, covering success and relevant failure or boundary cases. Use integration or
  live checks where the claim depends on interactions or external behaviour; substitutes must preserve the dependency
  contract.
- Never test a fix by reverting code or undoing the fix, including by running tests against a build or revision that
  lacks it. Verify fixes only on the fixed code.
- Verify the effective artifact and changed behaviour in the strongest accessible environment. The evidence that
  something works is observed product behaviour; a green suite, a stored row, a success status, a successful command, or
  intended configuration does not show that a user can complete the task. Exercise the built product the way its users
  work, with realistic, sustained, and demanding use, while following the logs of every unit the run touches, and
  confirm each reported effect in the screen, record, or device that owns it. Inspect material gaps left by passing
  tests, including misleading claims, missing effects, and broken interactions. Add proof where needed and limit claims
  to the evidence obtained. Compare failures with the base revision before calling them pre-existing; otherwise report
  their origin as unverified.
- Once required checks pass and the changed behaviour is verified, stop expanding verification without new evidence.
  Report relevant evidence and limits faithfully. For each unproven claim, name the exact observation that would
  establish it. Lack of production access limits the claim; deliver all work that can be completed and verified locally.
