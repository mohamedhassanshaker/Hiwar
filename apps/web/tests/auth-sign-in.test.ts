import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D387: the sign-in rules — the password, Forgot password, and UAE PASS's account linking
 * guidelines (automatic by Emirates ID, manual with the password, SOP1 refused). The database,
 * the cookies, UAE PASS itself and the session store are the external systems here, so they are
 * faked; the rules are the real code.
 */

process.env.DATABASE_URL ??= "postgresql://unused@localhost:5432/unused";
process.env.APP_KEK = Buffer.alloc(32, 7).toString("base64");
process.env.APP_URL = "https://awp.localtest.me:8443";
process.env.UAEPASS_CLIENT_ID = "sandbox_stage";
process.env.UAEPASS_CLIENT_SECRET = "sandbox_stage";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string | { name: string }) => jar.delete(typeof name === "string" ? name : name.name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9" }),
}));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => void task() }));

const repository = vi.hoisted(() => ({
  personWithPassword: vi.fn(),
  personById: vi.fn(),
  savePassword: vi.fn(),
  recordSignInMethod: vi.fn(),
  insertPasswordReset: vi.fn(),
  openPasswordReset: vi.fn(),
  spendPasswordReset: vi.fn(),
  personByUaePass: vi.fn(),
  personByEmiratesId: vi.fn(),
  uaePassOf: vi.fn(),
  linkUaePass: vi.fn(),
  personIdByInvitation: vi.fn(),
}));
vi.mock("@/features/auth/repository", () => repository);

const protocol = vi.hoisted(() => ({ exchangeCode: vi.fn(), userInfo: vi.fn() }));
vi.mock("@/features/auth/uae-pass", async (original) => ({ ...(await original<object>()), ...protocol }));

const sessions = vi.hoisted(() => ({ startSession: vi.fn(), endSession: vi.fn() }));
vi.mock("@/lib/auth", () => sessions);
const audits = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("@/lib/audit", () => audits);
const rate = vi.hoisted(() => ({ withinRate: vi.fn(async () => true), reachedLimit: vi.fn(async () => false), countAgainst: vi.fn(async () => 1) }));
vi.mock("@/lib/rate-window", () => rate);
const mail = vi.hoisted(() => ({ readMailSettings: vi.fn(), mailReady: vi.fn(() => true) }));
vi.mock("@/db/queries/mail", () => mail);
const mailer = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("@/lib/mailer", () => mailer);
vi.mock("@/db/queries/sessions", () => ({ deletePersonSessions: vi.fn() }));
vi.mock("@/db/queries/identity", () => ({ acceptInvitation: vi.fn(async () => true) }));

const { hashPassword } = await import("@/lib/password");
const { signInWithPassword, requestPasswordReset, resetPassword } = await import("@/features/auth/password-service");
const { beginUaePass, finishUaePass, pendingUaePass } = await import("@/features/auth/uae-pass-service");

const ACTIVE = { id: "p-1", email: "layla@tahseel.ae", nameEn: "Layla Ahmed", nameAr: "ليلى أحمد", status: "Active", emiratesId: null as string | null };
const PROFILE = { uuid: "uuid-1", userType: "SOP3", idn: "784189014978983", nameEn: "Layla Ahmed", nameAr: "ليلى أحمد" };
const storedHash = hashPassword("correct horse battery staple");

beforeEach(() => {
  jar.clear();
  for (const fake of [...Object.values(repository), ...Object.values(protocol), ...Object.values(sessions), audits.audit, mailer.sendMail]) fake.mockReset();
  repository.personByUaePass.mockResolvedValue(null);
  repository.personByEmiratesId.mockResolvedValue(null);
  repository.uaePassOf.mockResolvedValue(null);
  protocol.exchangeCode.mockResolvedValue("access-token");
  protocol.userInfo.mockResolvedValue(PROFILE);
  mailer.sendMail.mockResolvedValue(undefined);
  rate.reachedLimit.mockReset().mockResolvedValue(false);
  rate.countAgainst.mockClear();
});

/** Starts a UAE PASS sign-in and returns UAE PASS's callback parameters for it. */
async function roundTrip(extra: Record<string, string> = { code: "the-code" }): Promise<URLSearchParams> {
  const started = new URL(await beginUaePass("/work-items", "en"));
  return new URLSearchParams({ state: started.searchParams.get("state") ?? "", ...extra });
}

describe("signInWithPassword", () => {
  it("should_open_a_session_for_an_active_person_with_the_right_password", async () => {
    repository.personWithPassword.mockResolvedValue({ ...ACTIVE, passwordHash: await storedHash });

    await signInWithPassword(" Layla@Tahseel.ae ", "correct horse battery staple");

    expect(repository.personWithPassword).toHaveBeenCalledWith("layla@tahseel.ae");
    expect(sessions.startSession).toHaveBeenCalledWith("p-1", "Password");
    expect(audits.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth:sign_in", outcome: "Allowed" }));
  });

  it("should_count_only_wrong_attempts_and_refuse_every_attempt_once_the_limit_is_reached", async () => {
    repository.personWithPassword.mockResolvedValue({ ...ACTIVE, passwordHash: await storedHash });

    await signInWithPassword("layla@tahseel.ae", "correct horse battery staple");
    expect(rate.countAgainst).not.toHaveBeenCalled();
    await expect(signInWithPassword("layla@tahseel.ae", "wrong password!!")).rejects.toThrow("do not match");
    expect(rate.countAgainst).toHaveBeenCalledWith("signin:email:layla@tahseel.ae", 900);

    rate.reachedLimit.mockResolvedValue(true);
    await expect(signInWithPassword("layla@tahseel.ae", "correct horse battery staple")).rejects.toThrow("Too many attempts.");
    expect(sessions.startSession).toHaveBeenCalledTimes(1);
  });

  it("should_answer_a_wrong_password_and_an_unknown_address_the_same_way", async () => {    repository.personWithPassword.mockResolvedValueOnce({ ...ACTIVE, passwordHash: await storedHash }).mockResolvedValueOnce(null);

    await expect(signInWithPassword("layla@tahseel.ae", "wrong password!!")).rejects.toThrow("That email and password do not match.");
    await expect(signInWithPassword("nobody@tahseel.ae", "wrong password!!")).rejects.toThrow("That email and password do not match.");
    expect(sessions.startSession).not.toHaveBeenCalled();
  });

  it("should_refuse_a_suspended_person_only_after_the_right_password", async () => {
    repository.personWithPassword.mockResolvedValue({ ...ACTIVE, status: "Suspended", passwordHash: await storedHash });

    await expect(signInWithPassword("layla@tahseel.ae", "correct horse battery staple")).rejects.toThrow("Your access is suspended");
    expect(sessions.startSession).not.toHaveBeenCalled();
    expect(audits.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "Denied", detail: expect.objectContaining({ status: "Suspended" }) }));
  });
});

describe("Forgot password", () => {
  it("should_email_an_active_person_a_link_and_store_only_its_hash", async () => {
    repository.personWithPassword.mockResolvedValue({ ...ACTIVE, passwordHash: null });
    mail.readMailSettings.mockResolvedValue({});

    await requestPasswordReset("layla@tahseel.ae");
    await vi.waitFor(() => expect(mailer.sendMail).toHaveBeenCalled());

    const [, message] = mailer.sendMail.mock.calls[0] as [unknown, { to: string; text: string }];
    const token = /reset-password\/([\w-]+)/.exec(message.text)?.[1] ?? "";
    expect(message.to).toBe("layla@tahseel.ae");
    const [, storedTokenHash] = repository.insertPasswordReset.mock.calls[0] as [string, string];
    expect(storedTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedTokenHash).not.toContain(token);
  });

  it("should_send_nothing_for_an_address_that_has_no_active_account", async () => {
    repository.personWithPassword.mockResolvedValue(null);

    await requestPasswordReset("nobody@tahseel.ae");

    expect(repository.insertPasswordReset).not.toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it("should_refuse_a_spent_link_and_a_short_password", async () => {
    repository.openPasswordReset.mockResolvedValueOnce(null).mockResolvedValueOnce(ACTIVE);

    await expect(resetPassword("spent", "a long new password")).rejects.toThrow("expired or was used");
    await expect(resetPassword("open", "short")).rejects.toThrow("Use at least 12 characters.");
    expect(repository.savePassword).not.toHaveBeenCalled();
  });
});

describe("UAE PASS sign-in", () => {
  it("should_refuse_a_callback_whose_state_this_browser_did_not_start", async () => {
    await roundTrip();

    expect(await finishUaePass(new URLSearchParams({ state: "forged", code: "x" }))).toBe("/sign-in?error=UaePassFailed");
    expect(protocol.exchangeCode).not.toHaveBeenCalled();
  });

  it("should_say_the_user_cancelled_when_uae_pass_returns_access_denied", async () => {
    expect(await finishUaePass(await roundTrip({ error: "access_denied" }))).toBe("/sign-in?error=UaePassCancelled");
  });

  it("should_refuse_an_unverified_sop1_account", async () => {
    protocol.userInfo.mockResolvedValue({ ...PROFILE, userType: "SOP1", idn: null });

    expect(await finishUaePass(await roundTrip())).toBe("/sign-in?error=UaePassUnverified");
    expect(sessions.startSession).not.toHaveBeenCalled();
  });

  it("should_sign_in_the_person_an_already_linked_account_belongs_to", async () => {
    repository.personByUaePass.mockResolvedValue(ACTIVE);

    expect(await finishUaePass(await roundTrip())).toBe("/work-items");
    expect(sessions.startSession).toHaveBeenCalledWith("p-1", "UAE PASS");
    expect(repository.linkUaePass).not.toHaveBeenCalled();
  });

  it("should_link_automatically_by_the_emirates_id_an_admin_recorded", async () => {
    repository.personByEmiratesId.mockResolvedValue({ ...ACTIVE, emiratesId: PROFILE.idn });

    expect(await finishUaePass(await roundTrip())).toBe("/work-items");
    expect(repository.linkUaePass).toHaveBeenCalledWith("p-1", "uuid-1", "784189014978983");
    expect(sessions.startSession).toHaveBeenCalledWith("p-1", "UAE PASS");
  });

  it("should_refuse_a_suspended_person_found_by_emirates_id", async () => {
    repository.personByEmiratesId.mockResolvedValue({ ...ACTIVE, status: "Suspended" });

    expect(await finishUaePass(await roundTrip())).toBe("/sign-in?error=AccessSuspended");
    expect(repository.linkUaePass).not.toHaveBeenCalled();
  });

  it("should_send_an_unmatched_account_to_link_with_the_password_then_link_it_there", async () => {
    expect(await finishUaePass(await roundTrip())).toBe("/sign-in?link=uaepass&next=%2Fwork-items");
    expect(await pendingUaePass()).toEqual({ nameEn: "Layla Ahmed", nameAr: "ليلى أحمد" });

    repository.personWithPassword.mockResolvedValue({ ...ACTIVE, passwordHash: await storedHash });
    await signInWithPassword("layla@tahseel.ae", "correct horse battery staple");

    expect(repository.linkUaePass).toHaveBeenCalledWith("p-1", "uuid-1", "784189014978983");
    expect(sessions.startSession).toHaveBeenCalledWith("p-1", "Password");
    expect(await pendingUaePass()).toBeNull();
  });

  it("should_refuse_manual_linking_when_the_account_holds_a_different_emirates_id", async () => {
    await finishUaePass(await roundTrip());
    repository.personWithPassword.mockResolvedValue({ ...ACTIVE, emiratesId: "784199012345671", passwordHash: await storedHash });

    await expect(signInWithPassword("layla@tahseel.ae", "correct horse battery staple")).rejects.toThrow("cannot be linked");
    expect(repository.linkUaePass).not.toHaveBeenCalled();
    expect(sessions.startSession).not.toHaveBeenCalled();
  });
});
