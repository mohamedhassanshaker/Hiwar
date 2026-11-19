"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { changePasswordAction, signOutOthersAction, updateNameAction } from "@/app/profile-actions";
import { Dialog } from "@/components/dialog";
import { FormDialog, Switch, Tabs, useDialog } from "@/components/mock";
import { Payments } from "@/components/payments";
import { toast } from "@/components/toast";

export interface ProfileProps {
  name: string;
  email: string;
  role: string;
  orgs: { id: string; name: string; role: string }[];
  totp: boolean;
  totpRequired: boolean;
  sessions: { current: boolean; createdAt: string; expiresAt: string }[];
  notices: [string, string][];
  /** Organization name when the person can manage payment methods (Owner). */
  payOrg?: string;
  operator?: boolean;
}

function date(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

/** My profile (PLT-009, Profile board). Name, password, 2-step and sessions are live; the rest is sample. */
export function Profile(p: ProfileProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"details" | "security" | "notices" | "pay" | "data">("details");
  const [name, setName] = useState(p.name);
  const [linked, setLinked] = useState<Record<string, boolean>>({ Microsoft: false, Google: false });
  const [nt, setNt] = useState<Record<number, [boolean, boolean]>>({});
  const [pending, start] = useTransition();
  const dlg = useDialog<"pw" | "email" | "del">();
  const ini = p.name.split(/\s+/).map((x) => x[0] ?? "").slice(0, 2).join("").toUpperCase();
  const notices: [string, string][] = [...p.notices, ["Security alerts", "New sign-ins and password changes"]];
  const tabs: [typeof tab, string][] = [["details", "Personal details"], ["security", "Sign-in and security"], ["notices", "Notifications"]];
  if (p.payOrg) tabs.push(["pay", "Payment methods"]);
  tabs.push(["data", "Privacy and data"]);

  return (
    <div className="col gap-16">
      <div className="row gap-12">
        <span className="avatar lg">{ini}</span>
        <div className="col gap-0">
          <h1 className="h1">{p.name}</h1>
          <p className="sm muted">{p.role} · {p.email}</p>
        </div>
      </div>
      <Tabs label="Profile sections" value={tab} onChange={setTab} tabs={tabs} />

      {tab === "details" && (
        <div className="grid g2">
          <section className="card">
            <div className="card-h"><h2 className="card-t">Personal details</h2></div>
            <div className="card-c">
              <div className="row gap-8">
                <span className="avatar">{ini}</span>
                <button className="btn outline sm" onClick={() => toast("Photo uploaded. It shows once it has been checked.")}><i className="i i-upload" /> Change photo</button>
                <button className="btn ghost sm" onClick={() => toast("Photo removed. Your initials are shown instead.")}>Remove</button>
              </div>
              <span className="xs muted">JPG or PNG, up to 5 MB.</span>
              <div className="field">
                <label className="label" htmlFor="pf-n">Full name</label>
                <input id="pf-n" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="pf-e">Email</label>
                <div className="row nw gap-8">
                  <input id="pf-e" className="input" type="email" value={p.email} readOnly />
                  <button className="btn outline sm" onClick={() => dlg.show("email")}>Change</button>
                </div>
                <span className="hint"><i className="i i-check-circle" aria-hidden /> Verified</span>
              </div>
              <div className="field">
                <label className="label" htmlFor="pf-l">Language</label>
                <select id="pf-l" className="select"><option>English</option><option>Arabic (right to left)</option></select>
              </div>
              <div className="field">
                <label className="label" htmlFor="pf-t">Time zone</label>
                <select id="pf-t" className="select"><option>Gulf Standard Time (UTC+4)</option><option>Arabia Standard Time (UTC+3)</option></select>
              </div>
            </div>
            <div className="card-f">
              <button className="btn outline" onClick={() => setName(p.name)}>Cancel</button>
              <button
                className="btn"
                disabled={pending || name.trim() === p.name}
                onClick={() =>
                  start(async () => {
                    const r = await updateNameAction(name);
                    toast(r.ok ? "Profile saved." : r.error);
                    if (r.ok) router.refresh();
                  })
                }
              >
                Save changes
              </button>
            </div>
          </section>
          <aside className="card">
            <div className="card-h"><h3 className="card-t">Where you work</h3></div>
            <div className="card-c">
              {p.orgs.length === 0 && <span className="sm muted">Hiwar operator portal</span>}
              {p.orgs.map((o) => (
                <div key={o.id} className="row gap-8">
                  <span className="avatar sm">{o.name.slice(0, 2).toUpperCase()}</span>
                  <span className="col gap-0"><span className="sm b">{o.name}</span><span className="xs muted">{o.role}</span></span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      {tab === "security" && (
        <>
          <section className="card">
            <div className="card-h"><h2 className="card-t">How you sign in</h2></div>
            <div className="card-c">
              <div className="row between">
                <span className="col gap-0"><span className="b sm">Email and password</span><span className="xs muted">At least 12 characters</span></span>
                <button className="btn outline sm" onClick={() => dlg.show("pw")}>Change password</button>
              </div>
              {Object.keys(linked).map((k) => (
                <div key={k} className="row between">
                  <span className="col gap-0"><span className="b sm">{k}</span><span className="xs muted">{linked[k] ? `Linked · ${p.email}` : "Not linked · sample"}</span></span>
                  <button className={linked[k] ? "btn ghost sm" : "btn outline sm"} onClick={() => { setLinked({ ...linked, [k]: !linked[k] }); toast(linked[k] ? `${k} unlinked. You can still sign in with your email and password.` : `${k} linked. You can now sign in with it.`); }}>
                    {linked[k] ? "Unlink" : "Link"}
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card-c row between">
              <span className="col gap-0">
                <span className="b sm">2-step sign-in</span>
                <span className="xs muted">{p.totp ? "On · code from an authenticator app" : "Off"}{p.totpRequired ? " · required for your role or organization" : ""}</span>
              </span>
              {p.totp ? <span className="badge success">On</span> : <Link className="btn outline sm" href="/two-step/setup">Turn on</Link>}
            </div>
          </section>
          <section className="card">
            <div className="card-h">
              <h2 className="card-t">Where you’re signed in</h2>
              <button
                className="btn outline sm"
                disabled={pending || p.sessions.length < 2}
                onClick={() =>
                  start(async () => {
                    const r = await signOutOthersAction();
                    toast(r.ok ? `Signed out of ${r.data ?? 0} other sessions.` : r.error);
                    router.refresh();
                  })
                }
              >
                Sign out of other sessions
              </button>
            </div>
            <div className="card-c">
              {p.sessions.map((s) => (
                <div key={s.createdAt} className="row between sm">
                  <span>Signed in {date(s.createdAt)} · until {date(s.expiresAt)}</span>
                  {s.current && <span className="badge soft">This session</span>}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {tab === "notices" && (
        <section className="card">
          <div className="card-h"><div className="t"><h2 className="card-t">Notifications</h2><p className="card-d">In the bell and by email. Sample settings.</p></div></div>
          <div className="card-c table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Tell me about</th><th scope="col">In the bell</th><th scope="col">Email</th></tr></thead>
              <tbody>
                {notices.map(([t, d], i) => {
                  const lock = t === "Security alerts";
                  const st = nt[i] ?? [true, i % 2 === 0];
                  return (
                    <tr key={t}>
                      <td><div className="b sm">{t}</div><div className="xs muted">{d}</div></td>
                      <td><Switch on={lock || st[0]} disabled={lock} label={`${t} in the bell`} onChange={(v) => setNt({ ...nt, [i]: [v, st[1]] })} /></td>
                      <td><Switch on={lock || st[1]} disabled={lock} label={`${t} by email`} onChange={(v) => setNt({ ...nt, [i]: [st[0], v] })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="xs muted">Security messages are always sent.</p>
          </div>
        </section>
      )}

      {tab === "pay" && p.payOrg && <Payments orgName={p.payOrg} />}

      {tab === "data" && (
        <section className="card">
          <div className="card-h"><h2 className="card-t">Your data</h2></div>
          <div className="card-c">
            <div className="row between">
              <span className="col gap-0"><span className="b sm">Download a copy of your data</span><span className="xs muted">We email a download link within 48 hours</span></span>
              <button className="btn outline sm" onClick={() => toast("Export requested. We’ll email a download link within 48 hours.")}>Request</button>
            </div>
            <div className="row between">
              <span className="col gap-0">
                <span className="b sm">{p.operator ? "Ask to close your staff account" : "Delete your account"}</span>
                <span className="xs muted">{p.operator ? "Staff accounts are closed by a Platform admin." : "Deleted after 30 days; you can cancel until then. An Owner must hand over ownership first."}</span>
              </span>
              <button className={p.operator ? "btn outline sm" : "btn destructive sm"} onClick={() => (p.operator ? toast("Request sent to a Platform admin.") : dlg.show("del"))}>
                {p.operator ? "Send request" : "Delete account"}
              </button>
            </div>
          </div>
        </section>
      )}

      <Dialog
        open={dlg.is("pw")}
        title="Change password"
        description="At least 12 characters. Your other sessions are signed out."
        onClose={dlg.close}
        footer={<><button className="btn outline" onClick={dlg.close}>Cancel</button><button className="btn" form="pw-form" disabled={pending}>Change password</button></>}
      >
        <form
          id="pw-form"
          className="col gap-12"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const next = String(f.get("next"));
            if (next !== String(f.get("again"))) return toast("The new passwords don’t match.");
            start(async () => {
              const r = await changePasswordAction(String(f.get("current")), next);
              toast(r.ok ? "Password changed. Other sessions were signed out." : r.error);
              if (r.ok) {
                dlg.close();
                router.refresh();
              }
            });
          }}
        >
          <div className="field"><label className="label" htmlFor="pw-c">Current password</label><input id="pw-c" name="current" type="password" className="input" autoComplete="current-password" required /></div>
          <div className="field"><label className="label" htmlFor="pw-n">New password</label><input id="pw-n" name="next" type="password" className="input" autoComplete="new-password" minLength={12} required /></div>
          <div className="field"><label className="label" htmlFor="pw-a">New password again</label><input id="pw-a" name="again" type="password" className="input" autoComplete="new-password" minLength={12} required /></div>
        </form>
      </Dialog>
      <FormDialog
        open={dlg.is("email")}
        title="Change email"
        description="We send a link to the new address. Your email doesn’t change until you open it. Sample."
        confirm="Send link"
        onClose={dlg.close}
        fields={[{ name: "e", label: "New email", type: "email", required: true }]}
        onSubmit={(v) => (v.e.includes("@") ? "Check your new inbox for the link." : { error: "Enter an email address." })}
      />
      <FormDialog
        open={dlg.is("del")}
        title="Delete your account?"
        description="Your profile is deleted after 30 days. You can cancel during that time. Sample."
        confirm="Delete account"
        destructive
        onClose={dlg.close}
        fields={[{ name: "c", label: "Type DELETE to confirm", required: true }]}
        onSubmit={(v) => (v.c === "DELETE" ? "Deletion scheduled for 30 days from now. We emailed you how to cancel." : { error: "Type DELETE to confirm." })}
      />
    </div>
  );
}
