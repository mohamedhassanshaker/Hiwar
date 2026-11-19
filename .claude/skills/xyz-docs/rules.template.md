---
title: Documentation rules
status: approved
owner: Product owner
related: [README.md, {{FIRST_SOURCE}}]
version: 1.0
last-updated: {{TODAY}}
---

# Documentation rules

How the documents in `docs/` are organised, written and kept current. [README.md](README.md) lists the areas.

## 1. Structure

1. `docs/` is divided into numbered areas, one folder each: {{AREA_LIST}}.
2. Area numbers are identifiers. Do not renumber an area. A new area takes the next unused number and is added to the structure in `.claude/xyz.json` (`docs_structure`) and to `README.md`. When a folder is renamed or moved, fix every link to it in the same change.
3. Each document belongs to one area:

{{AREAS_TABLE}}

4. A fact lives in one document. Other documents link to it. Do not copy a rule, table or value into a second document.

## 2. Authority

1. The requirement sources ({{SOURCES}}) are the source of requirements. The feature specs in `{{SPECS_DIR}}` are derived from the business and UI sources and must cover all of them; the documents in the architecture areas are derived from the feature specs and the technical sources and must cover all of them.
2. When two documents disagree, the one higher in this list wins: requirement sources, feature specs, architecture and decisions, everything else. Fix the lower document in the same change.
3. A document that describes the code states the date it was last checked against the code. The code is the truth for how things work today; a document is the truth for what is required.

## 3. Files and names

1. Markdown only, UTF-8, one topic per file. File and folder names are lower-case kebab-case. Exception: `CHANGELOG.md`.
2. Decision records are `03-decisions/NNNN-slug.md`, numbered in sequence from `0000-adr-template.md`. A number is never reused.
3. Feature specs are `{{SPECS_DIR}}/<module>/<NNN-slug>/spec.md`. UI coverage ledgers are `{{SPECS_DIR}}/ui-coverage/<Screen>.md`.
4. Images and diagrams that belong to one document sit beside it. Diagrams are text (Mermaid) where the format allows.

## 4. Page format

1. Every new document starts with YAML front matter:

```yaml
---
title: <name of the document>
status: draft | approved | accepted | superseded
owner: <role, not a person>
related: [<documents or IDs>]
version: <major.minor>
last-updated: <YYYY-MM-DD>
---
```

2. One `#` heading that repeats the title, then `##` sections. Headings are sentence case. No skipped levels.
3. Update `version` and `last-updated` when the content changes. Documents that describe code also carry `Last verified against code: <date>`.
4. Existing documents keep their header style until they are next changed; then they move to this one.

## 5. Writing

1. Plain technical English. State facts, causes, actions and evidence. No marketing language, metaphors, slogans or em-dash asides.
2. Lead with the result. A document answers its question in the first paragraph.
3. Describe what is true now. History belongs in git and in the changelog. Do not write "formerly", "was changed", "removed" or "kept for reference" in a current document. Delete obsolete text, do not comment it out.
4. Use tables for attributes, states, roles and values; bullets for rules; numbered lists only for ordered steps or numbered rules. Number only what is referenced by number.
5. Numbers carry units and, for money, the currency and whether VAT is included. Values that are configured and not fixed are described as configured.
6. Explain a term the first time it appears, or link to the glossary.
7. Refer to roles, screens, modules and IDs exactly as the requirement sources name them.
8. Write paths, commands, identifiers and file names in backticks.
9. No secrets, credentials, personal data or private customer data in any document.

## 6. Requirements and specs

1. Requirement and decision IDs defined in the requirement sources are cited by code and tests. Do not renumber or reuse one. Delete a rule only when nothing cites it.
2. A requirement change is a change request in `00-input-requirements/change-requests` (`CR-NNN-slug.md`), applied with `cr.py apply` of the `xyz-docs` skill. Then update the feature specs and run the coverage check; it must print `0 problems`.
3. Every feature spec lists its source sections, carries the source IDs, and follows the spec template. Open points are `[NEEDS CLARIFICATION: ...]` with the open item ID; a decided point is a requirement.
4. Design conflicts are recorded as `[NEEDS CLARIFICATION: design shows X; specification says Y]` until the product owner decides. Never choose silently.
5. Every function of every design screen is a row in its UI coverage ledger that cites a spec requirement, or is marked as not a product function.
6. Use the scripts of the `xyz-docs` skill (`add_fr.py`, `remove_fr.py`) to add or remove requirements so numbering and references stay consistent.
7. Whether a spec is pending or completed is recorded only in `{{PM_DIR}}/specs-pending.md` and `specs-completed.md`, changed through `specs_board.py`. A completed spec needs evidence. Adding requirements to a completed spec reopens it.

## 7. Decisions

1. A decision is recorded where it is made: an ADR for an architecture choice, the decision log for a product or owner decision. Entries are dated and give the reason.
2. The decision log is append-only. A reversed decision gets a new entry that names the one it replaces.
3. When the owner decides a point listed as blocked or open, record it in the decision log and remove it from `blockers.md` and from the open items.

## 8. Links and generated content

1. Links between documents are relative and must resolve. Link to a heading only if it exists.
2. Text between `<!-- ...:start -->` and `<!-- ...:end -->` markers is generated. Change the source and rerun the script; do not edit it by hand.
3. Do not duplicate a list that a script generates (feature index, backlog rows, area table).

## 9. Keeping documents current

1. A change to behaviour, an interface, a data structure or a rule updates its canonical document in the same change.
2. When a document and the code disagree, correct whichever is wrong before the change is delivered. Do not record the disagreement as a note.
3. Documents that are replaced are deleted in the same change, together with every link to them.
4. Moves and renames update the links, the area table and the checks below.

## 10. Checks

Run before delivering a documentation change:

| Check | Command | Passes when |
| --- | --- | --- |
| Structure and links | `python .claude/skills/xyz-docs/scripts/docs_structure.py check` | `0 problems` |
| Requirements coverage | `python .claude/skills/xyz-docs/scripts/coverage.py verify` | `0 problems` |
| Spec structure | `python .claude/skills/xyz-docs/scripts/coverage.py lint` | `0 problems` |
| Architecture trace | `python .claude/skills/xyz-docs/scripts/coverage.py trace` | `0 problems` |
| Design coverage | `python .claude/skills/xyz-docs/scripts/ui_coverage.py verify` | `0 problems` |
| Spec board | `python .claude/skills/xyz-docs/scripts/specs_board.py check` | `0 problems` |
| Change requests | `python .claude/skills/xyz-docs/scripts/cr.py check` | `0 problems` |
