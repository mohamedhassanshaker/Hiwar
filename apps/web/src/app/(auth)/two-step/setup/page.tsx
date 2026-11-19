import QRCode from "qrcode";
import { redirect } from "next/navigation";

import { ActionForm, Field } from "@/components/form";
import { newTotpSecret, sealPending } from "@/server/accounts";
import { getSession } from "@/server/session";
import { setupTwoStepAction } from "../../actions";

export const metadata = { title: "Set up 2-step sign-in" };

/** ORG-004 FR-008: scan a QR code and confirm a code before using any screen. */
export default async function SetupPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const secret = newTotpSecret(session.user.email);
  const qr = await QRCode.toDataURL(secret.uri, { margin: 1, width: 180 });
  return (
    <>
      <h1 className="h2">Set up 2-step sign-in</h1>
      <p className="muted sm">Your organization requires a code from an authenticator app. Scan the QR code, then enter the code it shows.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="qr" src={qr} alt="QR code for your authenticator app" />
      <p className="xs muted">
        Can&apos;t scan? Enter this key: <span className="mono">{secret.base32}</span>
      </p>
      <ActionForm action={setupTwoStepAction} submit="Turn on 2-step sign-in" hidden={{ pending: sealPending(session.user.id, secret.sealed) }}>
        <Field label="6-digit code" name="code" autoComplete="one-time-code" />
      </ActionForm>
    </>
  );
}
