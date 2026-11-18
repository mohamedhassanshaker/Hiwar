"use client";

import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { mirrorRoom } from "@/features/engage/actions";
import { useAwp } from "@/hooks/use-awp";

/**
 * `UC-23.1-13`: links this room to a conversation on a channel.
 *
 * The conversation reference is the provider's own identifier for the thread, which is what
 * an inbound message carries; without it there is nothing to match a message to.
 */
export function MirrorRoom({ roomKey, onClose }: { roomKey: string; onClose: () => void }) {
  const { t } = useAwp();
  const [channelType, setChannelType] = useState("MicrosoftTeams");
  const [externalRef, setExternalRef] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, act] = useTransition();

  return (
    <Modal
      title={t("Mirror this room to a channel", "عكس هذا الاجتماع على قناة")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            label={t("Mirror", "عكس")}
            disabled={pending || externalRef.trim() === ""}
            onClick={() =>
              act(async () => {
                const outcome = await mirrorRoom({ roomKey, type: channelType, externalRef });
                if (outcome.ok) onClose();
                else setNote(outcome.reason);
              })
            }
          />
        </>
      }
    >
      <Field label={t("Channel", "القناة")}>
        <PopSelect className="awp-input" value={channelType} onChange={(event) => setChannelType(event.target.value)}>
          <option value="MicrosoftTeams">{t("Microsoft Teams", "مايكروسوفت تيمز")}</option>
          <option value="WhatsApp">{t("WhatsApp", "واتساب")}</option>
        </PopSelect>
      </Field>
      <Field label={t("Conversation reference", "معرّف المحادثة")} hint={t("The provider's identifier for the thread.", "معرّف المزوّد للمحادثة.")}>
        <input className="awp-input awp-mono" value={externalRef} onChange={(event) => setExternalRef(event.target.value)} />
      </Field>
      {note && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {note}
        </p>
      )}
    </Modal>
  );
}
