"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Confirm, Dialog } from "@/components/dialog";
import { toast } from "@/components/toast";
import type { ActionResult } from "@/server/actions";
import type { Role } from "@/server/authz";
import {
  cancelInviteAction,
  changeRoleAction,
  grantSupportAction,
  inviteAction,
  removeMemberAction,
  resendAction,
  revokeSupportAction,
  securityAction,
} from "./actions";

interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  twoStep: boolean;
  lastActive: string | null;
  self: boolean;
}

const ASSIGNABLE: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "builder", label: "Builder" },
  { value: "support_agent", label: "Support Agent" },
  { value: "analyst", label: "Analyst" },
  { value: "billing", label: "Billing" },
];

const MATRIX: [string, string[]][] = [
  ["Manage agents and knowledge", ["Yes", "Yes", "Yes", "No", "No", "No"]],
  ["Manage deployments", ["Yes", "Yes", "Yes", "No", "No", "No"]],
  ["View and reply to conversations", ["Yes", "Yes", "No", "Yes", "No", "No"]],
  ["Take over and hand back", ["Yes", "Yes", "No", "Yes", "No", "No"]],
  ["View analytics", ["Yes", "Yes", "Yes", "Limited", "Yes", "No"]],
  ["Manage plan and invoices", ["Yes", "No", "No", "No", "No", "Yes"]],
  ["Manage team and roles", ["Yes", "Yes", "No", "No", "No", "No"]],
  ["View audit log", ["Yes", "Yes", "No", "No", "No", "No"]],
  ["Take over from another person", ["Yes", "Yes", "No", "No", "No", "No"]],
  ["Approve or reject write tools", ["Yes", "Yes", "No", "Yes", "No", "No"]],
  ["Export analytics CSV", ["Yes", "Yes", "No", "No", "Yes", "No"]],
];

function when(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

export function TeamClient(props: {
  readOnly: boolean;
  seats: { used: number; limit: number };
  members: Member[];
  invitations: { id: string; email: string; roleLabel: string; expires: string }[];
  security: { require2fa: boolean; sessionDays: number };
  grant: { expires: string; includeConversations: boolean } | null;
}) {
  const [pending, start] = useTransition();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState<{ text: string; upgrade?: boolean } | null>(null);

  const run = (fn: () => Promise<ActionResult<unknown>>, success?: string, after?: () => void) =>
    start(async () => {
      const result = await fn();
      if (!result.ok) {
        setError({ text: result.error, upgrade: result.upgrade });
        return;
      }
      setError(null);
      after?.();
      if (success) toast(success);
    });

  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Team and roles</h1>
          <p className="lead">
            Who can build, answer and manage. {props.seats.used} of {props.seats.limit} seats used.
          </p>
        </div>
        {!props.readOnly && (
          <button className="btn" onClick={() => setInviting(true)}>
            <i className="i i-user-plus" /> Invite member
          </button>
        )}
      </div>

      {error && (
        <p className="note-p c-danger" role="alert">
          {error.text} {error.upgrade && <Link href="/billing">Upgrade</Link>}
        </p>
      )}

      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Members</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">2-step sign-in</th>
              <th scope="col">Last active</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {props.members.map((m) => (
              <tr key={m.userId}>
                <td className="b">{m.name}</td>
                <td>{m.email}</td>
                <td>
                  {m.role === "owner" || props.readOnly ? (
                    <span title={m.role === "owner" ? "The Owner's role is locked" : undefined}>{m.roleLabel}</span>
                  ) : (
                    <select
                      className="select"
                      aria-label={`Role of ${m.name}`}
                      value={m.role}
                      disabled={pending}
                      onChange={(e) => run(() => changeRoleAction(m.userId, e.target.value as Role), `${m.name} is now ${e.target.selectedOptions[0].text}.`)}
                    >
                      {ASSIGNABLE.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  <span className={m.twoStep ? "stt ok" : "stt mut"}>{m.twoStep ? "On" : "Off"}</span>
                </td>
                <td className="sm muted">{when(m.lastActive)}</td>
                <td className="r">
                  {m.role !== "owner" && !m.self && !props.readOnly && (
                    <button className="btn ghost sm" onClick={() => setRemoving(m)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {props.invitations.map((i) => (
              <tr key={i.id}>
                <td className="muted">Invited</td>
                <td>{i.email}</td>
                <td>{i.roleLabel}</td>
                <td>
                  <span className="stt warn">Pending</span>
                </td>
                <td className="sm muted">Expires {when(i.expires)}</td>
                <td className="r">
                  {!props.readOnly && (
                    <span className="row end gap-4">
                      <button className="btn ghost sm" onClick={() => run(() => resendAction(i.id), `Invitation sent again to ${i.email}.`)}>
                        Resend
                      </button>
                      <button className="btn ghost sm" onClick={() => run(() => cancelInviteAction(i.id), "Invitation cancelled.")}>
                        Cancel
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note-p">Role changes apply immediately: the member gets the new access on their next action, without signing in again.</p>

      <section className="card p-20 col gap-12" aria-labelledby="perm-h">
        <h2 className="h2" id="perm-h">
          Permissions by role
        </h2>
        <div className="table-wrap">
          <table className="table matrix">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {["Owner", "Admin", "Builder", "Support Agent", "Analyst", "Billing"].map((r) => (
                  <th scope="col" key={r}>
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map(([cap, cells]) => (
                <tr key={cap}>
                  <td>{cap}</td>
                  {cells.map((c, idx) => (
                    <td key={idx} className={c === "No" ? "muted" : c === "Yes" ? "c-success b" : "c-warning"}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SecurityCard readOnly={props.readOnly} security={props.security} save={(s) => run(() => securityAction(s), "Security settings saved.")} />

      <section className="card p-20 col gap-12" aria-labelledby="support-h">
        <h2 className="h2" id="support-h">
          Hiwar support access
        </h2>
        {props.grant ? (
          <div className="row between">
            <span>
              <span className="stt warn">Active</span> Read-only until {when(props.grant.expires)},{" "}
              {props.grant.includeConversations ? "including conversations" : "without conversations"}.
            </span>
            {!props.readOnly && (
              <button className="btn outline sm" onClick={() => run(() => revokeSupportAction(), "Support access revoked.")}>
                Revoke
              </button>
            )}
          </div>
        ) : (
          <div className="row between">
            <p className="note-p">Hiwar support cannot open your control panel unless you grant access here.</p>
            {!props.readOnly && (
              <button className="btn outline sm" onClick={() => setGranting(true)}>
                Grant support access
              </button>
            )}
          </div>
        )}
      </section>

      <InviteDialog
        open={inviting}
        busy={pending}
        onClose={() => setInviting(false)}
        onSend={(input) => run(() => inviteAction(input), `Invitation sent to ${input.email}.`, () => setInviting(false))}
      />
      <GrantDialog
        open={granting}
        onClose={() => setGranting(false)}
        onGrant={(input) => run(() => grantSupportAction(input), "Support access granted.", () => setGranting(false))}
      />
      <Confirm
        open={removing !== null}
        title={`Remove ${removing?.name ?? ""}?`}
        description="They lose access at once. Conversations they own go back to Needs a person."
        confirm="Remove member"
        destructive
        busy={pending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && run(() => removeMemberAction(removing.userId), `${removing.name} was removed.`, () => setRemoving(null))}
      />
    </>
  );
}

function SecurityCard({
  readOnly,
  security,
  save,
}: {
  readOnly: boolean;
  security: { require2fa: boolean; sessionDays: number };
  save: (s: { require2fa: boolean; sessionDays: number }) => void;
}) {
  return (
    <section className="card p-20 col gap-12" aria-labelledby="sec-h">
      <h2 className="h2" id="sec-h">
        Security
      </h2>
      <div className="row between">
        <div className="col gap-2">
          <span className="b">Require 2-step sign-in</span>
          <span className="sm muted">Members without it set it up at their next sign-in.</span>
        </div>
        <button
          role="switch"
          aria-checked={security.require2fa}
          aria-label="Require 2-step sign-in"
          className={security.require2fa ? "switch on" : "switch"}
          disabled={readOnly}
          onClick={() => save({ ...security, require2fa: !security.require2fa })}
        />
      </div>
      <div className="row between">
        <label className="b" htmlFor="session-days">
          Session length
        </label>
        <select
          id="session-days"
          className="select"
          style={{ width: 160 }}
          value={security.sessionDays}
          disabled={readOnly}
          onChange={(e) => save({ ...security, sessionDays: Number(e.target.value) })}
        >
          {[1, 7, 14, 30].map((d) => (
            <option key={d} value={d}>
              {d} {d === 1 ? "day" : "days"}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

function InviteDialog({
  open,
  busy,
  onClose,
  onSend,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSend: (input: { email: string; role: string; message?: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("support_agent");
  const [message, setMessage] = useState("");
  return (
    <Dialog
      open={open}
      title="Invite member"
      description="They get an email with a link that works for 7 days."
      onClose={onClose}
      footer={
        <>
          <button className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy || !email} onClick={() => onSend({ email, role, message: message || undefined })}>
            Send invitation
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="inv-email">
          Email
        </label>
        <input id="inv-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="inv-role">
          Role
        </label>
        <select id="inv-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ASSIGNABLE.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="inv-msg">
          Message (optional)
        </label>
        <textarea id="inv-msg" className="textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
    </Dialog>
  );
}

function GrantDialog({
  open,
  onClose,
  onGrant,
}: {
  open: boolean;
  onClose: () => void;
  onGrant: (input: { hours: number; includeConversations: boolean }) => void;
}) {
  const [hours, setHours] = useState(24);
  const [conv, setConv] = useState(false);
  return (
    <Dialog
      open={open}
      title="Grant support access"
      description="Hiwar support can open your control panel read-only until the access expires or you revoke it. Every page they view is in your audit log."
      onClose={onClose}
      footer={
        <>
          <button className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={() => onGrant({ hours, includeConversations: conv })}>
            Grant access
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="grant-h">
          For
        </label>
        <select id="grant-h" className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>1 hour</option>
          <option value={24}>24 hours</option>
          <option value={72}>72 hours</option>
        </select>
      </div>
      <label className="row gap-8">
        <input type="checkbox" checked={conv} onChange={(e) => setConv(e.target.checked)} /> Include conversation content
      </label>
    </Dialog>
  );
}
