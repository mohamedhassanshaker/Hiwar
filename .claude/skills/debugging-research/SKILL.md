---
name: debugging-research
description: Protocol for fixing defects and resolving uncertainty. Use for any bug fix, failing check or test, unexpected behaviour, unclear requirement, or reliance on an external API, library behaviour, or unverified assumption.
---

# Debugging and research

- Before a corrective change, establish observation (the exact failure or reproduction), mechanism (the causal path
  supported by source, primary references, or instrumentation), and prediction (the expected result and measurement that
  will confirm or refute it). If any is missing, research or instrument before applying the correction. An obvious
  defect may need only source inspection and a direct check. Do not guess values or change configuration without a
  hypothesis; remove discarded experiments.
- Classify defects as syntax, isolated logic, integration, state/architecture, or requirements. Prove isolation before
  treating a problem as local; otherwise trace the wider flow. Ask the owner only when intended behaviour remains
  unresolved. Fix the cause at its owning layer, inspect affected callers, and repeat the reproduction. For systemic
  defects, measure across affected cases.
- Start research from the sources listed under "Engineering and evidence" in CLAUDE.md and repository precedent. When evidence is insufficient, broaden research to
  relevant documentation, security/compliance effects, performance, standards, issues, and alternatives. If research
  does not converge or a decision requires the owner's judgment, present the evidence, viable options, trade-offs,
  concrete risks, unknowns, recommendation with rationale, and exact decision needed.
- Make material assumptions explicit and validate those affecting correctness: external APIs, edge/load/failure
  behaviour, platform differences, authorisation, performance, business interpretation, and hardware timing. Established
  language and documented standard-library semantics need no extra validation. Cite non-obvious external constraints
  beside the reliance, including the version and consequence if wrong. Keep unmeasured claims unverified until evidence
  supports them. Keep consequential undecided values open until evidence or an owner decision resolves them; never use
  guessed values as acceptance limits or consequential defaults.
