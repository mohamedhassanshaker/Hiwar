import Link from "next/link";

export default function InvalidVerification() {
  return (
    <>
      <h1 className="h2">This link is no longer valid</h1>
      <p className="muted">Verification links work once within 24 hours. Sign in and we send you a new one.</p>
      <Link className="btn" href="/sign-in">
        Sign in
      </Link>
    </>
  );
}
