---
name: xyz-docs-structure
description: Initialize and check a project's docs/ structure (numbered areas, README index, rules.md) and apply its rules when creating, moving or editing documents. Use when asked to set up or reset the docs folder, to add a documentation area or document, to move or rename docs, to write documentation rules, or to check docs structure and links.
---

# Docs structure

`docs/` has numbered areas, an index (`docs/README.md`) and the rules (`docs/rules.md`). The structure is `docs_structure` in `.claude/xyz.json` (areas with `dir`, `title`, `holds`, required `files` and `folders`, plus `root_files`); without it the skill uses `structure.default.json`:

| Folder | Holds |
| --- | --- |
| 00-input-requirements | Business specification, change requests |
| 01-product-requirements | Feature specs, glossary, non-functional rules, open questions |
| 02-architecture | Context, tech stack, solution design |
| 03-decisions | Decision log, ADRs |
| 04-api-and-integrations | APIs and external systems |
| 05-data | Data model, dictionary, ERDs |
| 06-security | Security architecture |
| 07-testing | Test conventions |
| 08-devops-and-deployment | Configuration, deployment, runbook |
| 09-releases-and-changelog | Changelog |
| 10-project-management | Spec backlog, completed specs, task backlog, blockers, progress log |

Numbers are identifiers: never renumber; a new area takes the next unused number. A project overrides names, numbers and contents in its own `docs_structure`.

## Commands

`python3 .claude/skills/xyz-docs-structure/scripts/docs_structure.py <command>`

| Command | Effect |
| --- | --- |
| `init` | Creates missing area folders, `docs/README.md` and `docs/rules.md` (from `rules.template.md` with the project's areas and paths). Never overwrites an existing file. |
| `index` | Regenerates the area table in `docs/README.md` from the structure. |
| `check` | Areas and required files exist, no folder outside the structure, every relative link in `docs/` resolves. Must print `0 problems`. |

## Initialize

1. Set the project's paths and structure in `.claude/xyz.json` if they differ from the defaults.
2. `docs_structure.py init`, then `docs_structure.py check`.
3. Fix reported links in the documents that own them, or restore the missing target. Do not change the structure to hide a problem.
4. Fill the areas with the other xyz skills: `xyz-business-spec`, `xyz-feature-specs`, `xyz-spec-backlog`.

## Change the structure

1. Add, rename or remove an area in `docs_structure` (`.claude/xyz.json`).
2. Update the area table in `docs/rules.md`, then run `docs_structure.py index`.
3. Move files with `git mv`, fix every link to them, run `check`.

## Create or edit a document

Follow `docs/rules.md`: one area per document, kebab-case name, YAML front matter, plain technical English, no history, one place per fact, relative links that resolve. Run the checks in the last section of `docs/rules.md` before delivering.
