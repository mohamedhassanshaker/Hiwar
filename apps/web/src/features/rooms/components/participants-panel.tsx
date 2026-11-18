"use client";

import { useState } from "react";

import { useAgents, usePeople } from "@/components/shared/directory";
import { Btn } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { setParticipant, setRoomAdmin } from "@/features/rooms/actions";
import type { RoomDetail } from "@/features/rooms/types";
import { orThrow } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";

const ROOM_ROLE: Record<string, [string, string]> = {
  Owner: ["Owner", "المستخدم"],
  Admin: ["Admin", "مسؤول"],
  Member: ["Member", "عضو"],
  LeadAgent: ["Lead agent", "الوكيل القائد"],
  MemberAgent: ["Member agent", "وكيل عضو"],
  Observer: ["Observer", "مراقب"],
};

/**
 * S-23: who is in the room, and, for its admins (D392), the means to bring people and agents
 * in, take them out and make a member an admin. A removed person loses access at once
 * (`UC-23.3-04`). Everybody else reads the list.
 */
export function ParticipantsPanel({ roomKey, participants, mayManage }: { roomKey: string; participants: RoomDetail["participants"]; mayManage: boolean }) {
  const { t, aName } = useAwp();
  const people = usePeople();
  const agents = useAgents();
  const [run, pending] = useAction();
  const [addWho, setAddWho] = useState("");
  /** The participant whose options menu is open. */
  const [menu, setMenu] = useState<string | null>(null);

  const remove = (id: string) =>
    run(async () => {
      orThrow(await setParticipant({ roomKey, principal: id, action: "Remove" }));
      return t("Participant removed.", "تمت إزالة المشارك.");
    });
  const toggleAdmin = (id: string, admin: boolean) =>
    run(async () => {
      orThrow(await setRoomAdmin({ roomKey, principal: id, admin }));
      return admin ? t("Made an admin.", "تم تعيينه مسؤولاً.") : t("No longer an admin.", "لم يعد مسؤولاً.");
    });

  return (
    <div>
      <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 900 }}>{t("Participants", "المشاركون")}</h4>
      <div className="awp-col" style={{ gap: 10 }}>
        {participants.map((participant) => (
          <div key={participant.id} className="awp-row" style={{ gap: 10 }}>
            <Who id={participant.id} s={32} online={participant.isAgent ? undefined : true} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{aName(participant.id)}</div>
              <div className="awp-small awp-muted">{t(...(ROOM_ROLE[participant.role] ?? [participant.role, participant.role]))}</div>
            </div>
            {participant.working && <Tg tone="info" dot label={t("Working", "يعمل")} />}
            {mayManage && participant.role !== "Owner" && (
              <span style={{ position: "relative", display: "flex" }}>
                <button
                  className="awp-iconbtn"
                  style={{ width: 32, height: 32, borderColor: "transparent", borderRadius: 999 }}
                  aria-label={t(`Options for ${aName(participant.id)}`, `خيارات ${aName(participant.id)}`)}
                  aria-haspopup="menu"
                  aria-expanded={menu === participant.id}
                  disabled={pending}
                  onClick={() => setMenu(menu === participant.id ? null : participant.id)}
                >
                  <Ic n="MoreVL" s={18} />
                </button>
                {menu === participant.id && (
                  <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 44 }} onClick={() => setMenu(null)} />
                    <div className="awp-card awp-menu" role="menu" style={{ minWidth: 160, padding: 6, borderRadius: 14 }}>
                      {/* Only a person who is a plain member or an admin takes part in the admin role. */}
                      {(participant.role === "Member" || participant.role === "Admin") && (
                        <button
                          role="menuitem"
                          className="awp-nav-i"
                          style={{ height: 36, fontSize: 14 }}
                          onClick={() => {
                            setMenu(null);
                            void toggleAdmin(participant.id, participant.role === "Member");
                          }}
                        >
                          {participant.role === "Admin" ? t("Remove admin", "إزالة صلاحية المسؤول") : t("Make admin", "تعيين كمسؤول")}
                        </button>
                      )}
                      <button
                        role="menuitem"
                        className="awp-nav-i"
                        style={{ height: 36, fontSize: 14, color: "var(--text-danger)" }}
                        onClick={() => {
                          setMenu(null);
                          void remove(participant.id);
                        }}
                      >
                        {t("Remove", "إزالة")}
                      </button>
                    </div>
                  </>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
      {mayManage ? (
        <div className="awp-row" style={{ gap: 8, marginTop: 10 }}>
          <PopSelect className="awp-input" value={addWho} onChange={(event) => setAddWho(event.target.value)} aria-label={t("Add participant", "إضافة مشارك")}>
            <option value="">{t("Add a participant…", "إضافة مشارك…")}</option>
            <optgroup label={t("People", "الأشخاص")}>
              {people
                .filter((person) => !participants.some((participant) => participant.id === person.id))
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </optgroup>
            {/* `UC-23.3-01`: an agent joins a room the same way a person does, and the
                service already resolves either kind of id to the right participant role —
                the picker only needed to offer one. */}
            <optgroup label={t("Agents", "الوكلاء")}>
              {agents
                // A platform-native agent (the page assistant) is not a room
                // collaborator a person picks — they have no business-agent role to play.
                .filter((agent) => !agent.isSystem)
                .filter((agent) => !participants.some((participant) => participant.id === agent.id))
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
            </optgroup>
          </PopSelect>
          <Btn
            type="secondary"
            label={t("Add", "إضافة")}
            disabled={pending || addWho === ""}
            onClick={() =>
              run(async () => {
                orThrow(await setParticipant({ roomKey, principal: addWho, action: "Add" }));
                setAddWho("");
                return t("Participant added.", "تمت إضافة المشارك.");
              })
            }
          />
        </div>
      ) : (
        <p className="awp-small awp-muted" style={{ margin: "10px 0 0" }}>
          {t("Only the room's admins can add or remove participants.", "يمكن لمسؤولي الاجتماع فقط إضافة المشاركين أو إزالتهم.")}
        </p>
      )}
    </div>
  );
}
