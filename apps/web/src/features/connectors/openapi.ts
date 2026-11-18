import { parse as parseYaml } from "yaml";

/**
 * Turns an OpenAPI or Swagger document into the connector tools an agent can call.
 *
 * `UC-54.1-09`: a REST API is described once, by its own specification document, rather
 * than by someone retyping each endpoint into a form. Every operation in the document
 * becomes one tool: its `operationId` is the tool name, its summary the description, and
 * its parameters a JSON Schema the model fills in.
 *
 * Nothing here calls the API. It reads a document and produces rows; the connector runtime
 * is what issues the requests, from exactly these operations.
 */

/** Where one parameter of an operation goes in the request. */
export type ParameterIn = "path" | "query" | "header" | "body";

/** One parameter the model supplies, and where the runtime puts it. */
export type OperationParameter = {
  name: string;
  in: ParameterIn;
  required: boolean;
  /** The JSON Schema of the value, as the document declares it. */
  schema: Record<string, unknown>;
  description: string;
};

/** One operation of the document, as a connector tool calls it. */
export type Operation = {
  /** The tool name an agent calls, e.g. `getPetById`. Unique within the connector. */
  name: string;
  method: "get" | "put" | "post" | "delete" | "patch" | "head" | "options";
  /** The path relative to the server URL, with `{placeholders}` left in place. */
  path: string;
  description: string;
  parameters: OperationParameter[];
  /** The JSON Schema the model's arguments are validated against. */
  parametersJsonSchema: Record<string, unknown>;
  /** `true` when the operation only reads, which is what decides its starting tier. */
  readOnly: boolean;
};

/** What one document turned into. */
export type ParsedDocument = {
  title: string;
  version: string;
  /** The first server the document declares, which the connector's URL defaults to. */
  serverUrl: string;
  operations: Operation[];
  /** What was skipped and why, so an operation that is missing is not missing silently. */
  skipped: string[];
};

/** Thrown when the uploaded bytes are not a specification this can read. */
export class NotAnApiDocument extends Error {
  constructor(
    message: string,
    readonly messageAr: string,
  ) {
    super(message);
    this.name = "NotAnApiDocument";
  }
}

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;
type Method = (typeof METHODS)[number];

/** Only GET and HEAD are read-only by the HTTP method's own definition. */
const READ_ONLY: ReadonlySet<string> = new Set(["get", "head"]);

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * A tool name the agent can call and a person can recognise.
 *
 * `operationId` when the document gives one, because that is the name its own authors use;
 * otherwise the method and path, which is unique by construction.
 */
function toolName(operationId: string, method: string, path: string): string {
  const fromId = operationId.trim().replace(/[^A-Za-z0-9_.-]/g, "_");
  if (fromId) return fromId.slice(0, 120);
  const fromPath = path.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${method}_${fromPath}`.slice(0, 120);
}

/** Resolves a `$ref` into the document, one level at a time. Unknown refs resolve to `{}`. */
function deref(document: Json, node: unknown, depth = 0): Json {
  const object = asObject(node);
  if (!object) return {};
  const ref = asString(object.$ref);
  if (!ref || depth > 10) return object;
  if (!ref.startsWith("#/")) return {};
  let current: unknown = document;
  for (const segment of ref.slice(2).split("/")) {
    const step = asObject(current);
    if (!step) return {};
    current = step[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return deref(document, current, depth + 1);
}

/** The request body's schema, from OpenAPI 3's `requestBody` or Swagger 2's `body` parameter. */
function bodySchema(document: Json, operation: Json): { schema: Json; required: boolean } | null {
  const body = deref(document, operation.requestBody);
  const content = asObject(body.content);
  if (content) {
    // JSON first: it is the one media type the runtime encodes. A body-only-as-form or
    // -as-xml operation is skipped rather than sent as JSON the server will reject.
    const json = asObject(content["application/json"]) ?? asObject(content["application/*+json"]);
    if (!json) return null;
    return { schema: deref(document, json.schema), required: body.required === true };
  }
  return null;
}

/** The parameters of one operation, already dereferenced, with the body folded in. */
function parametersOf(document: Json, pathItem: Json, operation: Json): OperationParameter[] {
  const declared = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ];

  const parameters: OperationParameter[] = [];
  const seen = new Set<string>();
  for (const entry of declared) {
    const parameter = deref(document, entry);
    const name = asString(parameter.name);
    const where = asString(parameter.in);
    if (!name || seen.has(`${where}:${name}`)) continue;
    // Swagger 2 puts the body in `parameters` with `in: body` and a `schema`; OpenAPI 3
    // puts it in `requestBody`. Both end up as one `body` parameter here.
    if (where === "body") {
      parameters.push({
        name: "body",
        in: "body",
        required: parameter.required === true,
        schema: deref(document, parameter.schema),
        description: asString(parameter.description),
      });
      seen.add("body:body");
      continue;
    }
    if (where !== "path" && where !== "query" && where !== "header") continue;
    seen.add(`${where}:${name}`);
    parameters.push({
      name,
      in: where,
      // A path parameter is required whatever the document says: the URL cannot be built
      // without it.
      required: where === "path" ? true : parameter.required === true,
      schema: asObject(parameter.schema) ?? { type: asString(parameter.type) || "string" },
      description: asString(parameter.description),
    });
  }

  if (!seen.has("body:body")) {
    const body = bodySchema(document, operation);
    if (body) {
      parameters.push({ name: "body", in: "body", required: body.required, schema: body.schema, description: "The request body." });
    }
  }
  return parameters;
}

/** The JSON Schema the model fills in: one property per parameter, body included. */
function schemaOf(parameters: OperationParameter[]): Json {
  const properties: Json = {};
  const required: string[] = [];
  for (const parameter of parameters) {
    properties[parameter.name] = parameter.description
      ? { ...parameter.schema, description: parameter.description }
      : parameter.schema;
    if (parameter.required) required.push(parameter.name);
  }
  return required.length > 0
    ? { type: "object", properties, required }
    : { type: "object", properties };
}

/** The document's first server URL, absolute where the document makes it so. */
function serverUrlOf(document: Json): string {
  const servers = Array.isArray(document.servers) ? document.servers : [];
  const first = asObject(servers[0]);
  if (first) return asString(first.url);
  // Swagger 2 names the host, base path and schemes separately.
  const host = asString(document.host);
  if (!host) return "";
  const schemes = Array.isArray(document.schemes) ? document.schemes.map(asString).filter(Boolean) : [];
  const scheme = schemes.includes("https") ? "https" : (schemes[0] ?? "https");
  return `${scheme}://${host}${asString(document.basePath)}`;
}

/**
 * Reads an OpenAPI 3.x or Swagger 2.0 document, in JSON or YAML.
 *
 * @throws {NotAnApiDocument} when the text is neither, or declares no operation at all —
 * a connector with no tools is a connector no agent can use, and failing here says why
 * rather than registering an empty one.
 */
export function parseApiDocument(text: string): ParsedDocument {
  let parsed: unknown;
  try {
    parsed = text.trim().startsWith("{") ? JSON.parse(text) : parseYaml(text);
  } catch (problem) {
    throw new NotAnApiDocument(
      `That file is not valid JSON or YAML: ${problem instanceof Error ? problem.message : String(problem)}`,
      "هذا الملف ليس JSON أو YAML صالحاً.",
    );
  }

  const document = asObject(parsed);
  if (!document || (!document.openapi && !document.swagger)) {
    throw new NotAnApiDocument(
      "That file carries no `openapi` or `swagger` version, so it is not an API description.",
      "لا يحمل هذا الملف إصدار openapi أو swagger، فهو ليس وصفاً لواجهة برمجية.",
    );
  }

  const info = asObject(document.info) ?? {};
  const paths = asObject(document.paths) ?? {};
  const operations: Operation[] = [];
  const skipped: string[] = [];
  const names = new Set<string>();

  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = deref(document, rawPathItem);
    for (const method of METHODS) {
      const operation = asObject(pathItem[method]);
      if (!operation) continue;
      if (operation.deprecated === true) {
        skipped.push(`${method.toUpperCase()} ${path}: deprecated`);
        continue;
      }

      const parameters = parametersOf(document, pathItem, operation);
      let name = toolName(asString(operation.operationId), method, path);
      if (names.has(name)) {
        // Two operations with the same id is a defect in the document, not a reason to
        // drop one: the second gets its method and path appended so both stay callable.
        name = toolName("", method, path);
        if (names.has(name)) {
          skipped.push(`${method.toUpperCase()} ${path}: duplicate operation name ${name}`);
          continue;
        }
      }
      names.add(name);

      operations.push({
        name,
        method: method as Method,
        path,
        description:
          asString(operation.summary) ||
          asString(operation.description) ||
          `${method.toUpperCase()} ${path}`,
        parameters,
        parametersJsonSchema: schemaOf(parameters),
        readOnly: READ_ONLY.has(method),
      });
    }
  }

  if (operations.length === 0) {
    throw new NotAnApiDocument(
      "That document declares no operation, so there is nothing for an agent to call.",
      "لا يعلن هذا المستند أي عملية، فلا يوجد ما يستدعيه الوكيل.",
    );
  }

  return {
    title: asString(info.title) || "API",
    version: asString(info.version),
    serverUrl: serverUrlOf(document),
    operations,
    skipped,
  };
}
