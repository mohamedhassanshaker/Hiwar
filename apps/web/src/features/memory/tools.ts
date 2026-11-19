import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { deleteMemoryInput, memoryListInput, restoreMemoryInput } from "./schema";
import * as service from "./service";

/**
 * S-55 as tools: what the Memory screen does, offered to an agent working on someone's
 * behalf.
 *
 * Writing a version is already in the catalogue as `memory_write`, and searching as
 * `memory_search`; this adds the rest of the screen. Reviewing is not here: a memory
 * waiting for review is waiting for a person, and an agent that could approve one could
 * approve what it proposed itself.
 */
export const MEMORY_TOOLS: PlatformTool[] = [
  action({
    subject: "memory",
    operation: "list",
    description:
      "The memories the acting person may see, a page at a time in tree order, with their " +
      "scope, status, version, owner, review state and content, and the total that match. " +
      "`q` matches words in the title or the content; `scope`, `status` and `reviewed` " +
      "narrow it. `open` names one memory by path, whose version history comes back too. " +
      "A scope their grants do not reach is absent rather than refused. Call this first: the " +
      "path is how every other tool names a memory, and the version is what a write has to " +
      "name back.",
    input: memoryListInput,
    permission: "memory:read",
    run: async ({ q, scope, status, reviewed, open, limit, offset }) => {
      const { memories, total, opened, versions } = await service.loadMemory({ q, scope, status, reviewed }, { limit, offset }, open);
      return { memories, total, opened, versions };
    },
  }),

  action({
    subject: "memory",
    operation: "rollback",
    description:
      "Put an older version's content back, as a new version. The old versions stay: " +
      "nothing in the history is rewritten. Returns the version number this created.",
    input: restoreMemoryInput,
    permission: "memory:write",
    run: async (input) => ({ version: await service.restoreVersion(input) }),
  }),

  action({
    subject: "memory",
    operation: "delete",
    description:
      "Delete a memory, with its whole version history and any review of it. An agent's " +
      "reach into a scope is a grant on the scope, so nothing else points at the entry.",
    input: deleteMemoryInput,
    permission: "memory:write",
    run: async ({ path }) => {
      await service.deleteMemory(path);
      return { deleted: path };
    },
  }),
];
