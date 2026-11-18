import { insertAuditEntry } from "@/db/queries/audit";
import { externalContactFor } from "@/db/queries/external-contacts";
import { audit } from "@/lib/audit";
import { requirePermission, requireProjectPermission } from "@/lib/session";
import { attributesProblem } from "./attributes";
import type { AttributeDefinition } from "./types";
import * as repository from "./repository";
import { RequestRejected } from "./errors";
import { startFirstStep } from "./step-agent-service";

/**
 * `UC-31.2-02`: a schedule whose type is a request type creates a request when it fires.
 *
 * The firing is a schedules act, so it is gated by `schedules:write`, and by `requests:write` in
 * the schedule's project as any request is; the request it raises is attributed to the person
 * who owns that firing. It goes through the same write as a person's own request, so a
 * scheduled request is in no way a second kind of request.
 */
export async function createFromSchedule(input: {
  requestTypeId: string;
  projectId: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
}): Promise<{ key: string; id: string | null }> {
  const session = await requirePermission("schedules:write");
  const codes = await repository.codesForSchedule(input);
  if (!codes) throw new Error("The schedule names a request type or a project that no longer exists.");
  await requireProjectPermission("requests:write", input.projectId);

  const key = await repository.createRequest({
    projectKey: codes.projectKey,
    requestTypeCode: codes.requestTypeCode,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    descriptionEn: input.descriptionEn,
    entryMode: "Form",
    attributes: {},
    requesterId: session.personId,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "requests:write",
    objectType: "Request",
    objectLabel: key,
    detail: { type: codes.requestTypeCode, project: codes.projectKey, raisedBy: "schedule" },
  });
  await startFirstStep(key, session.personId);
  return { key, id: await repository.requestIdByKey(key) };
}

/**
 * A request raised by an external contact through a channel or the embedded widget.
 *
 * There is no session to check: the requester is an external contact, not a person with
 * permissions. What makes it allowed is the request type itself — its published version has
 * to name the channel as an intake route — so that invariant is enforced here instead.
 *
 * @throws {Error} when the type does not take intake from that channel.
 */
export async function createFromConversation(input: {
  projectKey: string;
  requestTypeCode: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
  attributes: Record<string, string>;
  externalContactId: string;
  channel: string;
}): Promise<string> {
  const intake = await repository.intakeChannelsOf(input.requestTypeCode);
  if (!intake.includes(input.channel)) {
    throw new Error(`${input.requestTypeCode} does not take intake from ${input.channel}.`);
  }

  const key = await repository.createRequest({
    projectKey: input.projectKey,
    requestTypeCode: input.requestTypeCode,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    descriptionEn: input.descriptionEn,
    entryMode: "Form",
    attributes: input.attributes,
    requesterId: input.externalContactId,
    requesterType: "ExternalContact",
    channel: input.channel,
  });
  await insertAuditEntry({
    actorType: "ExternalContact",
    actorId: input.externalContactId,
    actorLabel: input.channel,
    action: "requests:write",
    objectType: "Request",
    objectId: null,
    objectLabel: key,
    detailJson: { type: input.requestTypeCode, project: input.projectKey, raisedBy: input.channel },
    outcome: "Allowed",
  });
  // An external contact is not a person a run can act for, so an agent audience on the first
  // step is recorded as not started rather than run under somebody else.
  await startFirstStep(key, null);
  return key;
}

/** What the external intake widget draws, and the snippet that loads it. */
export type IntakeProfile = {
  code: string;
  nameEn: string;
  nameAr: string;
  projectKey: string;
  attributes: AttributeDefinition[];
};

/**
 * `UC-30.1-04`: the published request type an external site may raise a request against.
 *
 * Reached without a console session, so it answers only for a type whose published
 * version lists `Widget` as an intake channel and names a project to raise into. Anything
 * else is `null`, which the route turns into a 404 rather than a reason.
 */
export async function intakeProfile(code: string): Promise<IntakeProfile | null> {
  const profile = await repository.widgetIntakeProfile(code);
  if (!profile) return null;
  if (!profile.intakeChannels.includes("Widget")) return null;
  if (!profile.projectKey) return null;
  return {
    code: profile.code,
    nameEn: profile.nameEn,
    nameAr: profile.nameAr,
    projectKey: profile.projectKey,
    // A step's attributes are asked at that step, not on a stranger's form (D304).
    attributes: profile.attributes.filter((attribute) => attribute.stepName === null),
  };
}

/**
 * `UC-30.1-04`: a request raised from an external site's embedded form.
 *
 * The submitter is an external contact keyed by the email they gave, the same identity
 * the widget channel uses, so two submissions from one address are one contact. Every
 * required attribute is checked here: the form is on somebody else's page and nothing
 * about what it posted can be trusted to have passed through it.
 *
 * @throws {RequestRejected} when the type takes no widget intake or a required attribute
 * is missing.
 */
export async function createFromIntakeWidget(input: {
  requestTypeCode: string;
  contactName: string;
  contactEmail: string;
  summary: string;
  attributes: Record<string, string>;
}): Promise<string> {
  const profile = await intakeProfile(input.requestTypeCode);
  if (!profile) {
    throw new RequestRejected("That request type takes no requests from a website.", "لا يستقبل هذا النوع طلبات من موقع خارجي.");
  }

  const problem = attributesProblem(
    profile.attributes,
    Object.fromEntries(profile.attributes.map((attribute) => [attribute.key, String(input.attributes[attribute.key] ?? "")])),
    null,
  );
  if (problem) throw new RequestRejected(problem.en, problem.ar);

  const contactId = await externalContactFor("Widget", input.contactEmail, input.contactName);
  // Only the attributes the type declares are stored: a field the form invented is not
  // part of this request type and has nowhere to go.
  const declared = Object.fromEntries(
    profile.attributes
      .map((attribute) => [attribute.key, String(input.attributes[attribute.key] ?? "")] as const)
      .filter(([, value]) => value !== ""),
  );

  return createFromConversation({
    projectKey: profile.projectKey,
    requestTypeCode: profile.code,
    titleEn: input.summary.slice(0, 200),
    titleAr: input.summary.slice(0, 200),
    descriptionEn: `${input.contactName} <${input.contactEmail}>: ${input.summary}`,
    attributes: declared,
    externalContactId: contactId,
    channel: "Widget",
  });
}
