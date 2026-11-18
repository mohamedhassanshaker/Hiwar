import type { ModalRegistry } from "@/components/shared/modal-host";

import { ScheduleModal } from "@/features/schedules/components/schedule-modal";
import { ActionModal } from "./action-modal";
import { NewProjectModal, NewRequestTypeModal } from "@/features/projects/components/create-modals";
import { ImportSkillModal, NewSkillModal } from "@/features/projects/components/skill-modals";
import { UploadFileModal } from "@/features/files/components/file-modals";
import { PreviewModal } from "@/features/files/components/preview-modal";
import { SearchPalette } from "./search-palette";
import { NewRequestModal } from "@/features/requests/components/new-request-modal";
import { NewWorkItemModal } from "@/features/work-items/components/work-modals";
import { NewRoomModal } from "@/features/work-items/components/new-room-modal";

/** The modal registry the prototype kept on `window`, with exactly the same keys. */
export const MODAL_REGISTRY: ModalRegistry = {
  act: ActionModal,
  workitem: NewWorkItemModal,
  room: NewRoomModal,
  request: NewRequestModal,
  schedule: ScheduleModal,
  upload: UploadFileModal,
  importSkill: ImportSkillModal,
  preview: PreviewModal,
  search: SearchPalette,
  project: NewProjectModal,
  rtype: NewRequestTypeModal,
  skill: NewSkillModal,
};
