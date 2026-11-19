import Link from "next/link";

import { ActionForm, Field } from "@/components/form";
import { signUpAction } from "../actions";

export const metadata = { title: "Start free" };

export default function SignUpPage() {
  return (
    <>
      <div className="col gap-4">
        <h1 className="h2">Start your 14-day trial</h1>
        <p className="muted sm">Growth features, 100 AI conversations and 1 deployment. No card needed.</p>
      </div>
      <ActionForm action={signUpAction} submit="Start free">
        <Field label="Your name" name="name" autoComplete="name" />
        <Field label="Work email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="new-password" hint="At least 12 characters." />
        <Field label="Organization name" name="orgName" autoComplete="organization" />
      </ActionForm>
      <p className="sm muted">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </>
  );
}
