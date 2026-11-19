import { ActionForm, Field } from "@/components/form";
import { ROLE_LABEL } from "@/server/authz";
import { findInvitation } from "@/server/accounts";
import { acceptInviteAction } from "../actions";

export const metadata = { title: "Join your team" };

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const found = await findInvitation(token);
  if (!found) {
    return (
      <>
        <h1 className="h2">This invitation is no longer valid</h1>
        <p className="muted">Invitations work for 7 days. Ask the person who invited you for a new one.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="h2">Join {found.org.name}</h1>
      <p className="muted sm">
        You are invited as {ROLE_LABEL[found.invitation.role]} with {found.invitation.email}.
      </p>
      {found.invitation.message && <p className="sm">“{found.invitation.message}”</p>}
      <ActionForm action={acceptInviteAction} submit="Join" hidden={{ token }}>
        <Field label="Your name" name="name" autoComplete="name" />
        <Field label="Password" name="password" type="password" autoComplete="new-password" hint="At least 12 characters. If you already have a Hiwar account, enter its password." />
      </ActionForm>
    </>
  );
}
