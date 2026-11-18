import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { agentUpdateFileInput, attachFileInput, itemListInput, setFileStatusInput, uploadFileInput } from "./schema";
import * as service from "./service";

/**
 * S-32 and S-33 as tools: what the Artifacts and Files screens do, offered to an agent
 * working on someone's behalf.
 *
 * Creating an artifact is already in the catalogue as `artifact_create`, which takes a
 * generated document straight from the model's own output; this adds the rest of what the
 * two screens do.
 *
 * A file's scope of use is not here. It is who may read the file, so an agent that could
 * set it could grant itself a file it may not read — it is absent rather than gated, and
 * `file_edit` takes only the status.
 */
export const FILE_TOOLS: PlatformTool[] = [
  action({
    subject: "artifact",
    operation: "list",
    description:
      "The artifacts the acting person may see, newest first, a page at a time, with its " +
      "project, its size, who or what produced it, what it is linked to, its status, its type " +
      "and the run behind it, and the total that match. `q` matches words in the name; " +
      "`project` is a project key. Each carries its version, which an edit has to name back.",
    input: itemListInput,
    permission: "files:read",
    run: ({ q, project, limit, offset }) => service.loadArtifacts({ q, project }, { limit, offset }),
  }),

  action({
    subject: "file",
    operation: "list",
    description:
      "The project files the acting person may read, newest first, a page at a time, with its " +
      "project, size, uploader, scope of use, who it is granted to, status and type, and the " +
      "total that match. A file outside this person's scope of use is not listed. `q` matches " +
      "words in the name; `project` is a project key. Each carries its version, which an edit " +
      "has to name back.",
    input: itemListInput,
    permission: "files:read",
    run: ({ q, project, limit, offset }) => service.loadFiles({ q, project }, { limit, offset }),
  }),

  action({
    subject: "file",
    operation: "create",
    description:
      "Upload a file into a project, as the `data:` URL its bytes make. The scope of use " +
      "decides who may read it afterwards. A type or size the platform will not store is " +
      "refused; a file the scanner flags is kept but quarantined, and the reason comes " +
      "back with the result.",
    input: uploadFileInput,
    permission: "files:write",
    run: (input) => service.uploadFile(input),
  }),

  action({
    subject: "file",
    operation: "edit",
    description:
      "Take an artifact or a project file out of use, or put it back. `expectedVersion` " +
      "is the version last read — an item somebody has saved since is refused, so read it " +
      "again and retry. Returns what changed, before and after. The scope of use is not " +
      "editable here: who may read a file is a decision for a person in the console.",
    input: agentUpdateFileInput,
    permission: "files:write",
    run: (input) => service.updateFile(input),
  }),

  action({
    subject: "file",
    operation: "delete",
    description:
      "Delete an artifact or a project file. The bytes go; the audit record of it stays. " +
      "Pass the same name and kind the list returned.",
    input: setFileStatusInput,
    permission: "files:write",
    run: async (input) => {
      await service.deleteItem(input);
      return { deleted: input.name };
    },
  }),

  action({
    subject: "attachment",
    operation: "create",
    description:
      "Attach a file to a request, a work item or a room, as the `data:` URL its bytes " +
      "make. An attachment belongs to the item rather than to the project, so whoever may " +
      "see the item may read it. A file the scanner flags is not attached at all.",
    input: attachFileInput,
    permission: "files:write",
    run: (input) => service.attachFile(input),
  }),
];
