import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D393: registering without an invitation — what a registration stores, who is told, that a
 * Pending person cannot sign in, and what an approval or a decline does. The database, the
 * session, the mail server and the clock are the external systems, so they are faked; the
 * rules are the real code.
 */

process.env.DATABASE_URL ??= "postgresql://unused@localhost:5432/unused";
process.env.APP_KEK = Buffer.alloc(32, 7).toString("base64");
process.env.APP_URL = "https://awp.localtest.me:8443";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9" }),
}));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => void task() }));

const repository = vi.hoisted(() => ({
  personWithPassword: vi.fn(),
  insertRegistrant: vi.fn(),
  approverIds: vi.fn(),
  notifyApprovers: vi.fn(),
  emailsOf: vi.fn(),
  pendingRegistrant: vi.fn(),
  activateRegistrant: vi.fn(),
  deleteRegistrant: vi.fn(),
  resolveRegistrationItems: vi.fn(),
  roleIdByCode: vi.fn(),
  orgUnitExists: vi.fn(),
}));
vi.mock("@/features/auth/repository", () => repository);

const audits = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("@/lib/audit", () => audits);
const rate = vi.hoisted(() => ({ withinRate: vi.fn(async () => true), reachedLimit: vi.fn(async () => false), countAgainst: vi.fn(async () => 1) }));
vi.mock("@/lib/rate-window", () => rate);
const mail = vi.hoisted(() => ({ readMailSettings: vi.fn(async () => ({})), mailReady: vi.fn(() => true) }));
vi.mock("@/db/queries/mail", () => mail);
const mailer = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("@/lib/mailer", () => mailer);
const live = vi.hoisted(() => ({ notifyInbox: vi.fn() }));
vi.mock("@/lib/live", () => live);
vi.mock("@/lib/auth", () => ({ startSession: vi.fn() }));
vi.mock("@/db/queries/sessions", () => ({ deletePersonSessions: vi.fn() }));
vi.mock("@/db/queries/identity", () => ({ acceptInvitation: vi.fn() }));

const held = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async (permission: string) => {
    if (!held.permissions.has(permission)) throw new Error(`not permitted: ${permission}`);
    return { personId: "approver-1", nameEn: "Mariam Al Suwaidi" };
  }),
}));

const { registerWithPassword, approveRegistration, declineRegistration } = await import("@/features/auth/registration-service");
const { signInWithPassword } = await import("@/features/auth/password-service");
const { hashPassword, verifyPassword } = await import("@/lib/password");

const PASSWORD = "correct horse battery staple";
const UNIT = "0a4e3c1e-5b3a-4f55-9f4b-3b7d2a1c9e10";
const NEW = { nameEn: "Sara Khan", nameAr: "", email: "Sara.Khan@Example.com", orgUnitId: UNIT, password: PASSWORD };
const PENDING = { id: "p-9", email: "sara.khan@example.com", nameEn: "Sara Khan", nameAr: "Sara Khan", status: "Pending", emiratesId: null };

beforeEach(() => {
  for (const fake of [...Object.values(repository), audits.audit, mailer.sendMail, live.notifyInbox]) fake.mockReset();
  held.permissions = new Set(["registrations:approve"]);
  repository.insertRegistrant.mockResolvedValue("p-9");
  repository.approverIds.mockResolvedValue(["a-1", "a-2"]);
  repository.emailsOf.mockResolvedValue(["a1@example.com", "a2@example.com"]);
  repository.pendingRegistrant.mockResolvedValue(PENDING);
  repository.activateRegistrant.mockResolvedValue(true);
  repository.deleteRegistrant.mockResolvedValue(true);
  repository.resolveRegistrationItems.mockResolvedValue(["a-1", "a-2"]);
  repository.roleIdByCode.mockResolvedValue("role-member");
  repository.orgUnitExists.mockResolvedValue(true);
});

describe("D393 registering", () => {
  it("stores a Pending person with a hashed password and tells every approver in the Inbox and by email", async () => {
    await registerWithPassword(NEW);

    const stored = repository.insertRegistrant.mock.calls[0][0];
    expect(stored).toMatchObject({ email: "sara.khan@example.com", nameEn: "Sara Khan", nameAr: "Sara Khan", initials: "SK", orgUnitId: UNIT, uaePass: null });
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored.passwordHash)).toBe(true);
    expect(repository.notifyApprovers).toHaveBeenCalledWith("p-9", ["a-1", "a-2"]);
    expect(live.notifyInbox).toHaveBeenCalledTimes(2);
    expect(mailer.sendMail.mock.calls.map(([, message]) => message.to)).toEqual(["a1@example.com", "a2@example.com"]);
    expect(mailer.sendMail.mock.calls[0][1].html).toContain("/people?status=Pending");
    expect(audits.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth:register", objectId: "p-9" }));
  });

  it("refuses an address already on the platform, and tells nobody", async () => {
    repository.insertRegistrant.mockResolvedValue(null);
    await expect(registerWithPassword(NEW)).rejects.toThrow(/already registered/);
    expect(repository.notifyApprovers).not.toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it("refuses an organization that does not exist, before storing anything", async () => {
    repository.orgUnitExists.mockResolvedValue(false);
    await expect(registerWithPassword(NEW)).rejects.toThrow(/organization/);
    expect(repository.insertRegistrant).not.toHaveBeenCalled();
  });

  it("refuses a password the rules refuse and an address that is not one, before storing anything", async () => {
    await expect(registerWithPassword({ ...NEW, password: "short" })).rejects.toThrow();
    await expect(registerWithPassword({ ...NEW, email: "not-an-address" })).rejects.toThrow(/not an email/);
    expect(repository.insertRegistrant).not.toHaveBeenCalled();
  });

  it("refuses when this network address has registered too often", async () => {
    rate.withinRate.mockResolvedValueOnce(false);
    await expect(registerWithPassword(NEW)).rejects.toThrow(/Too many registrations/);
    expect(repository.insertRegistrant).not.toHaveBeenCalled();
  });
});

describe("D393 a Pending person signing in", () => {
  it("is told the registration is waiting for approval, with the right password, and gets no session", async () => {
    repository.personWithPassword.mockResolvedValue({ ...PENDING, passwordHash: await hashPassword(PASSWORD) });
    await expect(signInWithPassword("sara.khan@example.com", PASSWORD)).rejects.toThrow(/waiting for approval/);
  });
});

describe("D393 deciding a registration", () => {
  it("approves as a Member by default, closes the approvers' items and emails the person", async () => {
    await approveRegistration({ personId: "p-9" });

    expect(repository.roleIdByCode).toHaveBeenCalledWith("Member");
    expect(repository.activateRegistrant).toHaveBeenCalledWith("p-9", "role-member", null, "approver-1");
    expect(repository.resolveRegistrationItems).toHaveBeenCalledWith("p-9");
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail.mock.calls[0][1]).toMatchObject({ to: "sara.khan@example.com" });
    expect(mailer.sendMail.mock.calls[0][1].html).toContain("/sign-in");
  });

  it("refuses a role other than Member to an approver who may not grant permissions", async () => {
    await expect(approveRegistration({ personId: "p-9", roleCode: "Administrator" })).rejects.toThrow(/permissions:write/);
    expect(repository.activateRegistrant).not.toHaveBeenCalled();
  });

  it("lets an approver who may grant permissions choose the role", async () => {
    held.permissions.add("permissions:write");
    await approveRegistration({ personId: "p-9", roleCode: "Approver" });
    expect(repository.roleIdByCode).toHaveBeenCalledWith("Approver");
    expect(repository.activateRegistrant).toHaveBeenCalled();
  });

  it("refuses somebody without registrations:approve", async () => {
    held.permissions.clear();
    await expect(approveRegistration({ personId: "p-9" })).rejects.toThrow(/registrations:approve/);
    await expect(declineRegistration("p-9")).rejects.toThrow(/registrations:approve/);
    expect(repository.activateRegistrant).not.toHaveBeenCalled();
    expect(repository.deleteRegistrant).not.toHaveBeenCalled();
  });

  it("says a registration was already decided when another approver got there first", async () => {
    repository.activateRegistrant.mockResolvedValue(false);
    await expect(approveRegistration({ personId: "p-9" })).rejects.toThrow(/already decided/);
    expect(mailer.sendMail).not.toHaveBeenCalled();

    repository.pendingRegistrant.mockResolvedValue(null);
    await expect(declineRegistration("p-9")).rejects.toThrow(/already decided/);
  });

  it("declines by removing the registration and closing the approvers' items, without an email", async () => {
    await declineRegistration("p-9");
    expect(repository.deleteRegistrant).toHaveBeenCalledWith("p-9");
    expect(repository.resolveRegistrationItems).toHaveBeenCalledWith("p-9");
    expect(mailer.sendMail).not.toHaveBeenCalled();
    expect(audits.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "registrations:approve", detail: { decision: "Declined" } }));
  });
});
