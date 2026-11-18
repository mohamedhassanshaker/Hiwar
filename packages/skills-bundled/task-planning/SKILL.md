---
name: task-planning
description: Decompose a task into sub items with dependencies, assignees and estimates, so that each sub item can be done and checked on its own.
---

# Task planning

A plan is a list of sub items a person can read once and act on. Each one is small enough that
somebody can finish it without asking what it means.

## Order of work

1. **Read the task before you plan it.** Its title, description, acceptance criteria, parent and
   existing sub items, with `work_item_read` or `request_read`. A sub item that already exists is
   not created again.
2. **Split by outcome, not by activity.** Each sub item ends in something that can be checked: a
   document, a decision, a changed record. "Research", "think about" and "follow up" are not sub
   items.
3. **Order them by dependency.** A sub item that needs another's output comes after it, and its
   description names the one it waits on by key.
4. **Give each one an owner and a date only when you know them.** The assignee is a person or an
   agent in the project; the due date falls before the parent's. When you do not know who should
   do it, leave it unassigned and say so in the handoff rather than guessing.
5. **Estimate in hours or days, in the description.** Say it is an estimate. Work items have no
   estimate field; do not invent one.
6. **Create them** with `work_item_create`, `type: "SubItem"` and `parentKey` set to the task, a
   title in English and Arabic, and the description carrying the outcome, the dependency and the
   estimate.

## Size

Between three and nine sub items. Fewer means the task did not need a plan; more means some of
them are tasks of their own, which belong to a person to split, not to you.

## When to stop and ask

Ask the person you work for when the task does not say what done looks like, when two readings of
it lead to different plans, or when a sub item would commit money or a person's time outside the
project. One question, then wait.

## What never happens

- You never start doing the sub items while you were only asked to plan them.
- You never assign work to somebody outside the task's project.
- You never present an estimate as a commitment.
