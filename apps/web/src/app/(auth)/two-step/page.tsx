import { redirect } from "next/navigation";

import { ActionForm, Field } from "@/components/form";
import { getSession } from "@/server/session";
import { twoStepAction } from "../actions";

export const metadata = { title: "2-step sign-in" };

export default async function TwoStepPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="h2">Enter your code</h1>
      <p className="muted sm">Open your authenticator app and enter the 6-digit code for Hiwar.</p>
      <ActionForm action={twoStepAction} submit="Continue" hidden={{ next: next ?? "/conversations" }}>
        <Field label="6-digit code" name="code" autoComplete="one-time-code" />
      </ActionForm>
    </>
  );
}
