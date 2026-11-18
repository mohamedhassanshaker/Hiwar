import { permittedAnywhere } from "@/authz/evaluate";
import { PERMISSIONS } from "@/authz/permissions";
import { requirePermission, requireSession, visibleProjectIds } from "@/lib/session";
import type { Directory } from "@/types/directory";
import * as repository from "./repository";

export {
  PeopleError,
  type InviteOutcome,
  invitePeople,
  resendInvitation,
  invitationForToken,
  changePersonPlacement,
  suspendPerson,
  deletePerson,
  emiratesIdOf,
  setEmiratesId,
  loadRolePermissions,
  setRolePermissions,
} from "./people-service";
export {
  loadMyProfile,
  startPasskeyRegistration,
  finishPasskeyRegistration,
  removePasskey,
} from "./profile-service";
export { loadOrgChart, ReportingLineError, changeReportingLine, wouldReportInCircles } from "./org-chart-service";
export {
  orgUnitHistory,
  OrgUnitError,
  createOrgUnit,
  type OrgUnitDiff,
  updateOrgUnit,
  removeOrgUnit,
} from "./org-unit-service";

/**
 * Organisation: who works here, human and agent, and what they are allowed to see of each
 * other. Screens S-04, S-05, S-40, S-41 and S-42.
 */

/**
 * The directory the console layout hands to the client: the signed-in person, the agents,
 * the people and the projects. Read once per request.
 */
export async function loadDirectory(): Promise<Directory> {
  const session = await requireSession();
  const [agents, people, projects] = await Promise.all([
    repository.listAgents(),
    repository.listPeople(),
    repository.listProjects(await visibleProjectIds("projects:read")),
  ]);
  const me = people.find((person) => person.id === session.personId) ?? {
    id: session.personId,
    ini: session.initials,
    photo: null,
    name: session.nameEn,
    nameAr: session.nameAr,
    role: "",
    roleAr: "",
    email: session.email,
  };
  return { me, agents, people, projects, may: permittedAnywhere(session.principal) };
}

/**
 * S-41: the People and Roles tabs, with what the pickers on them need.
 *
 * People here are everyone, not only the active ones the rest of the console names, because
 * an invitation and a suspension are both states this screen exists to show.
 */
export async function loadPeopleAndRoles(filter: repository.PeopleFilter = {}) {
  await requirePermission("organisation:read");
  const [people, peopleTotal, roles, units, roleChoices] = await Promise.all([
    repository.listPeopleForAdministration(filter),
    repository.countPeopleForAdministration(filter),
    repository.listRoles(),
    repository.orgUnitOptions(),
    repository.roleOptions(),
  ]);
  return { people, peopleTotal, roles, units, roleChoices, permissions: PERMISSIONS };
}

/** S-42: the org units table, and the units a new one may be parented to. */
export async function loadOrgUnits() {
  await requirePermission("organisation:read");
  const [units, options] = await Promise.all([repository.listOrgUnits(), repository.orgUnitOptions()]);
  return { units, options };
}

/**
 * The org units a form may put something in.
 *
 * Needs only a session: choosing a unit for an agent, a person or a project is not reading
 * the organisation's administration, and every feature that offers the choice would
 * otherwise reach into this feature's repository.
 */
export async function orgUnitChoices() {
  await requireSession();
  return repository.orgUnitOptions();
}
