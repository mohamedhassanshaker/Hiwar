---
name: xyz-business-spec
description: Write or update a project's business specification (scope, platform model, rules, personas, screens, acceptance criteria) in one standard structure and style. Use when asked to add, change or draft a feature, rule, screen, persona, policy or acceptance criteria, or to create the business specification of a project.
---

# Business specification

The business specification is one Markdown file, the source of business requirements. Its path is `business_spec` in `.claude/xyz.json` (default `docs/00-input-requirements/business-specification.md`). Read the sections you will change before writing; edit in place and match what is there. Do not create a second file for the same subject. Feature specs are derived from it with `xyz-feature-specs`.

## Structure

| Part | Holds | Add here |
| --- | --- | --- |
| 1. Business overview | Product, goals, modules, scope, how it is built | New module, goal, in/out-of-scope item |
| 2. Feature specification | 1 platform model (tenants, roles, permissions, domain model), 2 platform rules (numbered), 3 shared policies, 4 and following: screens by portal or audience, last: open items | Scope, roles, permissions, menus, what a screen does, cross-cutting policy |
| 3. Rules, personas, flows, acceptance criteria | 0 conventions, 2 global `BR`/`BL` rules, 3 personas, 4 per-screen sections, 5 `IX` interactions, 6 `SM` state machines, 7 fixtures, 8 traceability, 9 open items | Testable rules, field tables, `SR`, `AC`, interactions, state machines |

Part 2 wins over Part 3 on roles, menus and screens. Each fact lives in one place; link to an existing rule ("Part 2 section 3.4", "BR-AREA-03") instead of restating it. IDs are cited by code and tests: never renumber or reuse one; delete a rule only when nothing cites it (`grep -r`).

## IDs

`P-nn` persona · `<Screen>` screen ID, identical to the design artboard name · `BR-<AREA>-nn` global rule · `BL-<AREA>-nn` calculation or algorithm · `SR-<Screen>-nn` screen rule · `AC-<Screen>-nn` screen criterion · `IX-nn` cross-persona interaction · `AC-IX-nn-mm` · `SM-nn` state machine · `PR-nn` platform rule (Part 2 section 2) · `FO-nn` open item (Part 2 last section). A project can add series (listed in section 0.1 of the specification and in `id_patterns` of `.claude/xyz.json`). The next number in a series is the highest existing + 1. Mark new or renamed screens **(new)** or **(renamed)**.

## Style

- Plain technical English. Short declarative sentences, present tense. No marketing language, metaphors or em-dash asides.
- Name roles, screens and terms exactly as the specification and glossary do; one term per concept.
- Money: state currency and whether tax is included. Numbers carry units ("within 7 days", "30 minutes"). A value that is configured and not fixed is described as configured.
- Tables for attributes, roles, states and prices; bullets for rules; numbered lists only for ordered steps or numbered rules. Headings sentence case.
- Every statement is testable or a definition. Undecided points go to the open-items section, not the body.
- No history, change logs or "formerly" notes in the body.

## Templates

### Business rule (Part 3 section 2)

```markdown
### 2.<n> <Area> (`BR-<AREA>`)

| ID | Rule |
| --- | --- |
| BR-<AREA>-01 | <One rule, one observable behaviour. Include limits and numbers.> |
```

### Screen section (Part 3 section 4)

```markdown
#### <Screen-ID> — <Screen name>

Purpose: <one or two sentences and the entry points>.

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| <field_name> | <type from 0.4> | yes/no | <rule> |

Screen rules:
- SR-<Screen-ID>-01 <Rule> [BR-<AREA>-nn]

Logic: <calculation or state change, if any>.

Acceptance criteria:
- AC-<Screen-ID>-01 — Given <state>, When <action>, Then <single observable outcome> [BR-<AREA>-nn].
```

Types (section 0.4): `uuid`, `text(n)`, `email`, `money`, `pct`, `date`, `datetime`, `enum{…}`, `ref:<Entity>`, `file`. Examples use the fixtures of Part 3 section 7 and its fixed test date.

### Feature screen entry (Part 2 screens sections)

```markdown
#### <Screen name> (`<Screen-ID>`) **(new)**

<What the screen does, as bullets: who sees it, what they can do, the rules specific to it, links to shared policies.>
```

### Persona (Part 3 section 3)

```markdown
### P-<nn> <Persona>

| Item | Detail |
| --- | --- |
| Who | <Fixture names and context> |
| Scope | <What they do> |
| Benefit | <Skill, Outcome or Operations: result> |
| Can't | <Explicit limits> |
| Screens | <Screen IDs> |
| Success measures | <Measures> |
```

### Interaction (Part 3 section 5)

```markdown
### IX-<nn> <Interaction>

- AC-IX-<nn>-01 — Given <actors and state>, Then <observable result across personas, including audit event and notification>.
```

Add the row to the interaction map. State machines go in section 6 as `` `a → b → c` `` chains and end with "Transitions not listed are invalid".

## Procedure

1. Find where the subject already exists: `grep -n` for the screen ID, rule area or term.
2. Decide the part: scope, role or menu → Part 2; testable rule or criterion → Part 3. Any new behaviour that code will cite gets a Part 3 rule.
3. Write with the templates; link to existing rules.
4. Update the traceability table (Part 3 section 8) when a numbered decision is implemented.
5. Check: no restated rule, IDs unique (`grep -c '<id>'`), every `AC` has Given/When/Then, every new screen is in its menu and its persona's screen list.
6. Update the feature specs with `xyz-feature-specs` and run its `verify`.
