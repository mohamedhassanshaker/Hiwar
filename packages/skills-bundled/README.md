# `packages/skills-bundled`

The Agent Skills every installation of the platform ships with. They are copied into the agent
image at `AWP_SKILLS_PATH` (`/app/skills`) and seeded as skills by the web app. When a run
starts, the agent service reads the run's granted skills from there with the harness's own
`Skills(...).load()` (`services/agent/src/awp_agent/mission/skills.py`) and adds each body to
the run's instructions (D127).

| Skill | What it is for |
| --- | --- |
| `guided-platform-creation` | Create or configure any platform object (request type, project, agent, skill, etc.) by discovering available options from live data and asking step-by-step questions. |
| `bilingual-writing` | Writing in the reader's language, with Tahseel's Arabic terminology and the "estimate" rule on every money value. |
| `work-item-execution` | Completing a work item assigned to an agent, end to end. |
| `task-planning` | Decomposing a task into sub items with dependencies, owners and estimates. |
| `request-triage` | Classifying an incoming request at agentic request entry. |
| `platform-operations` | Carrying out one or many consecutive platform actions through the Platform connector, as the person asking. Built in: it cannot be deleted. |

## The shape of a skill

A folder with a `SKILL.md`. The YAML frontmatter carries `name` and `description`; `name` must be
the folder's name, as the Agent Skills standard requires, or the loader skips the skill. The
standard's progressive disclosure (only the frontmatter in the index, the body on demand) is not
used yet: under Temporal the library's `load_capability` cannot run, so a granted skill's whole
body is in the instructions from the first turn (D127).

```markdown
---
name: folder-name
description: One sentence saying when this skill applies.
---

# Short name

The instructions.
```

An organisation's own skills are uploaded through the Skills screen and stored in the `skills`
object-storage bucket; they are not kept here. The agent service reads them from there before a
run and loads them with the same loader as this bundle.
