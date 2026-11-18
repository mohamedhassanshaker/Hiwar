---
name: platform-operations
description: Carry out work on the platform that takes one or many consecutive actions — reading, creating, changing and moving records through the Platform connector's tools — with the authority of the person asking and no more.
allowed-tools: project_list, request_list, request_read, work_item_search, work_item_read, person_list, role_list
---

# Platform operations

You act on the platform through its own tools, the Platform connector. Every call runs as the
person you work for: the platform checks their permissions and your grant on each call, so a
call they could not make is refused, and you never try to get around a refusal.

## Tool names

Tools are named `<subject>_<operation>`: `request_type_create`, `work_item_edit`,
`project_member_create`. The operations are `list`, `get`, `search` and `read` (look),
`create` and `edit` (change), and `publish`, `delete`, `apply`, `rollback` (decisions that
wait for a person's approval). Tools that change something may not be listed until you search
for them: search by subject and operation, for example "request type step create".

## Doing several actions in a row

1. **Find out what exists first.** Call the `_list`, `_search`, `_get` or `_read` tools for
   every record the work touches. Use the keys and ids they return. Never invent a key, an id or
   a name of something that should already exist.
2. **Plan the order.** Write the actions as a numbered list before the first change. A record
   comes before anything that points at it: a project before its members, a request type before
   its steps, a step before its audiences and rules.
3. **Ask once for what is missing, with `ask_person`.** If a value only the person can decide
   is missing, ask for all of them in one `ask_person` call before the first change: a choice
   between known values as `options`, and several values as `fields`, each with a sensible
   `default`. Never list the choices in your reply instead: a list in text gives the person
   nothing to click.
4. **Do one action at a time** and read its result before the next. Carry forward the keys and
   versions each result returns.
5. **Never repeat a create blindly.** Before creating, check that the record is not already
   there, so that a retried mission does not make a duplicate.
6. **Edits carry the record's version.** Send the `expectedVersion` you last read. When an edit
   is refused as stale, read the record again, apply the same change to what is there now, and
   try once more.
7. **Check the result.** After the last action, read back what you changed and confirm it
   matches what was asked.

## When a call is refused

The refusal says why. Tell the person in plain words and stop that branch of the work:

- `user_permission`: the person may not do this. Name the permission it needs.
- `agent_grant`: you were not granted the tool. Say which tool an administrator would add.
- `approval_required`: the call waits for a person's approval. The mission pauses and resumes
  on its own when it is decided. Do not call it again with different arguments to avoid it.
- `room_read_floor`: in a room you may read only what every member may see.

Continue with the actions that do not depend on the refused one, and say which were skipped.

## Reporting

End with what you did, in order: each record by its key with what changed, what was skipped and
why, and what is waiting for an approval. Do not say an action succeeded unless its result
said so.
