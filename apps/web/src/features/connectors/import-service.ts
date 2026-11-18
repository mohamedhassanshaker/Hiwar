import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import { NotAnApiDocument, parseApiDocument, type Operation } from "./openapi";
import type { ImportApiConnectorInput } from "./schema";
import { mergeCredential } from "./credential";
import { ConnectorRejected } from "./errors";

/** What an import produced, which the drawer reports back. */
export type ImportOutcome = {
  code: string;
  title: string;
  serverUrl: string;
  tools: number;
  /** Operations the document declared that could not be registered, and why. */
  skipped: string[];
  /** Stored Disabled until a person adds the credential its authorisation needs (D277). */
  awaitsCredential: boolean;
};

/**
 * `UC-54.1-09`: register a REST API as a connector from its OpenAPI or Swagger document.
 *
 * Every operation becomes one tool, at the tier its HTTP method earns — a GET reads and
 * nothing else does, so a read-only operation starts at T0 and everything else at the
 * connector's own default rather than at the loosest tier. The calls themselves are issued
 * by this application (`openapi-call.ts`), which is where the credential is stored.
 *
 * @throws {ConnectorRejected} when the document cannot be read, declares no operation, no
 * server URL can be determined, or the code is already taken.
 */
export async function importApiConnector(input: ImportApiConnectorInput): Promise<ImportOutcome> {
  const session = await requirePermission("connectors:write");

  let parsed;
  try {
    parsed = parseApiDocument(input.document);
  } catch (problem) {
    if (problem instanceof NotAnApiDocument) throw new ConnectorRejected(problem.message, problem.messageAr);
    throw problem;
  }

  const serverUrl = (input.serverUrl || parsed.serverUrl).trim();
  if (!/^https?:\/\//.test(serverUrl)) {
    throw new ConnectorRejected(
      "The document names no http or https server, so give one here.",
      "لا يذكر المستند خادماً بصيغة http أو https، فأدخل عنواناً هنا.",
    );
  }
  // An agent never handles a credential (D277): what it imports waits, Disabled, for a person
  // to add one in the console.
  const authType = input.credential?.type ?? input.authType;
  const credential = input.credential ? mergeCredential(input.credential, null) : null;
  const awaitsCredential = authType !== "None" && (!credential || credential === "missing");
  if (awaitsCredential && !session.actingAgent) {
    throw new ConnectorRejected(
      "That authorisation needs a credential.",
      "تحتاج طريقة التفويض هذه إلى بيانات اعتماد.",
    );
  }
  if (await repository.connectorIdByCode(input.code)) {
    throw new ConnectorRejected("A connector with that code already exists.", "يوجد موصل بهذا الرمز بالفعل.");
  }

  await repository.saveApiConnector(
    {
      code: input.code,
      nameEn: input.nameEn || parsed.title,
      nameAr: input.nameAr || input.nameEn || parsed.title,
      serverUrl,
      authType,
      credential: credential === "missing" ? null : credential,
      defaultTier: input.defaultTier,
      enabled: input.enabled && !awaitsCredential,
      operations: parsed.operations.map((operation) => ({
        operation,
        tier: operation.readOnly ? "T0" : input.defaultTier,
      })),
    },
    session.personId,
  );

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "connectors:write",
    objectType: "Connector",
    objectLabel: input.code,
    detail: {
      imported: "OpenApi",
      title: parsed.title,
      version: parsed.version,
      serverUrl,
      operations: parsed.operations.length,
      skipped: parsed.skipped.length,
    },
  });

  return {
    code: input.code,
    title: parsed.title,
    serverUrl,
    tools: parsed.operations.length,
    skipped: parsed.skipped,
    awaitsCredential,
  };
}

/** The operations a stored API connector registered, for the drawer to list. */
export async function apiOperations(connectorCode: string): Promise<Operation[]> {
  await requirePermission("connectors:read");
  return repository.apiOperations(connectorCode);
}
