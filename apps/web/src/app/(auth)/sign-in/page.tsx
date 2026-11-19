import Link from "next/link";

import { ActionForm, Field } from "@/components/form";
import { signInAction } from "../actions";

export const metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  expired: "Your session has expired. Sign in again to continue.",
  "no-organization": "Your account is not a member of an organization.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  return (
    <>
      <h1 className="h2">Sign in</h1>
      {reason && REASONS[reason] && <p className="sm c-warning" role="status">{REASONS[reason]}</p>}
      <ActionForm action={signInAction} submit="Sign in" hidden={{ next: next ?? "/conversations" }}>
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
      </ActionForm>
      <div className="row between sm">
        <Link href="/forgot-password">Forgot password</Link>
        <Link href="/sign-up">Start free</Link>
      </div>
    </>
  );
}
