"use server";

import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { AttributeDefinition } from "./types";

/**
 * The published request types a person may submit against, with the attributes of the
 * version a new request would pin. The New Request modal needs them before it can draw
 * its form, and nothing else in the console does.
 */
export type PublishedType = {
  code: string;
  nameEn: string;
  nameAr: string;
  /** The attributes the request form asks; a step's own are asked at that step (D304). */
  attributes: AttributeDefinition[];
  /** `UC-28.1-05`: a type that allows only one entry mode disables the other. */
  entryModes: string[];
};

/**
 * Every published request type with its form attributes and entry modes (Template form when the
 * version names none). Needs `requests:read`.
 */
export async function loadPublishedTypes(): Promise<PublishedType[]> {
  await requirePermission("requests:read");
  const types = (await repository.listRequestTypes()).filter((type) => type.st === "Published");
  return Promise.all(
    types.map(async (type) => ({
      code: type.c,
      nameEn: type.n,
      nameAr: type.nAr,
      attributes: (await repository.attributeDefinitionsOf(type.c)).filter((attribute) => attribute.stepName === null),
      entryModes: (await repository.readRequestTypeDetail(type.c))?.entryModes ?? ["TemplateForm"],
    })),
  );
}
