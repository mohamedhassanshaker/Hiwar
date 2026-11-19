import { ActionForm, Field } from "@/components/form";
import { forgotAction } from "../actions";

export const metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="h2">Reset your password</h1>
      <ActionForm action={forgotAction} submit="Send link">
        <Field label="Email" name="email" type="email" autoComplete="email" />
      </ActionForm>
    </>
  );
}
