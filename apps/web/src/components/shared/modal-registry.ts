import type { ModalRegistry } from "@/components/shared/modal-host";

import { ImportSkillModal, NewSkillModal } from "@/features/skills/components/skill-modals";
import { ActionModal } from "./action-modal";

/** The modals the AI capabilities open by key: confirmations and the two skill dialogs. */
export const MODAL_REGISTRY: ModalRegistry = {
  act: ActionModal,
  importSkill: ImportSkillModal,
  skill: NewSkillModal,
};
