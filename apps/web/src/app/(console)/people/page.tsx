import { People } from "@/features/organisation/components/people";
import { loadPeopleAndRoles } from "@/features/organisation/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

const STATUSES = ["Active", "Invited", "Pending", "Suspended"];

/** S-41: the people in the organisation and the roles they hold; people searched and paged on the server (D349). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const status = STATUSES.find((value) => value === one("status"));
  const page = pageOf(one("page") || undefined);
  const { people, peopleTotal, roles, units, roleChoices, permissions } = await loadPeopleAndRoles({
    text: one("q").trim() || undefined,
    status,
    limit: SERVER_PAGE_SIZE,
    offset: (page - 1) * SERVER_PAGE_SIZE,
  });
  return (
    <People
      people={people}
      page={{ page, total: peopleTotal, size: SERVER_PAGE_SIZE }}
      filters={{ q: one("q"), status: status ?? "all" }}
      roles={roles}
      units={units}
      roleChoices={roleChoices}
      permissions={permissions}
    />
  );
}
