import { ActionForm, Field } from "@/components/form";
import { resetAction } from "../actions";

export const metadata = { title: "New password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="h2">Set a new password</h1>
      <ActionForm action={resetAction} submit="Save password" hidden={{ token: token ?? "" }}>
        <Field label="New password" name="password" type="password" autoComplete="new-password" hint="At least 12 characters." />
      </ActionForm>
    </>
  );
}
