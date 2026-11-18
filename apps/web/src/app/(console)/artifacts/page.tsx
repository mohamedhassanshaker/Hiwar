import  { Artifacts } from "@/features/files/components/project-items";
import  { loadArtifacts } from "@/features/files/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/** S-32: what agents and people produced inside a project. One page at a time, filtered on the server by project and name (D349). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const page = pageOf(one("page") || undefined);
  const filters = { project: one("project") || undefined, q: one("q").trim() || undefined };
  const listed = await loadArtifacts(filters, { limit: SERVER_PAGE_SIZE, offset: (page - 1) * SERVER_PAGE_SIZE });
  return <Artifacts {...listed} page={{ page, total: listed.total, size: SERVER_PAGE_SIZE }} filters={{ project: one("project"), q: one("q") }} />;
}
