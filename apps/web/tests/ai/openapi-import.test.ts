import { describe, expect, it } from "vitest";

import { NotAnApiDocument, parseApiDocument } from "@/features/connectors/openapi";

/**
 * `UC-54.1-09`: a REST API is registered from its own specification document.
 *
 * What matters is that every operation becomes a tool an agent can actually call: the
 * right method and path, the parameters in the places the request needs them, and a
 * schema the model can fill in. An operation parsed into the wrong place is a call that
 * fails at the API, which is the one failure the import exists to prevent.
 */

const OPENAPI_3 = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Payments", version: "2.1.0" },
  servers: [{ url: "https://api.example.com/v2" }],
  paths: {
    "/payments/{paymentId}": {
      parameters: [{ name: "paymentId", in: "path", required: true, schema: { type: "string" } }],
      get: {
        operationId: "getPayment",
        summary: "Read one payment",
        parameters: [{ name: "expand", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "ok" } },
      },
      delete: {
        operationId: "cancelPayment",
        summary: "Cancel a payment",
        responses: { "204": { description: "gone" } },
      },
    },
    "/payments": {
      post: {
        operationId: "createPayment",
        summary: "Take a payment",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Payment" } } },
        },
        responses: { "201": { description: "made" } },
      },
    },
  },
  components: {
    schemas: {
      Payment: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] },
    },
  },
});

const SWAGGER_2 = `
swagger: "2.0"
info:
  title: Legacy
  version: "1.0"
host: legacy.example.com
basePath: /api
schemes: [https]
paths:
  /things:
    post:
      operationId: addThing
      summary: Add a thing
      parameters:
        - name: body
          in: body
          required: true
          schema:
            type: object
            properties:
              label:
                type: string
`;

describe("reading an OpenAPI 3 document", () => {
  const parsed = parseApiDocument(OPENAPI_3);

  it("takes the title and the server the document declares", () => {
    expect(parsed.title).toBe("Payments");
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.serverUrl).toBe("https://api.example.com/v2");
  });

  it("makes one tool per operation, named by its operation id", () => {
    expect(parsed.operations.map((operation) => operation.name).sort()).toEqual([
      "cancelPayment",
      "createPayment",
      "getPayment",
    ]);
  });

  it("carries a path-level parameter down to every operation under that path", () => {
    // Declared once on the path item, needed by both the GET and the DELETE — an
    // operation missing it would build a URL with `{paymentId}` still in it.
    for (const name of ["getPayment", "cancelPayment"]) {
      const operation = parsed.operations.find((one) => one.name === name);
      expect(operation?.parameters.some((parameter) => parameter.name === "paymentId" && parameter.in === "path")).toBe(true);
    }
  });

  it("resolves a `$ref` body into the schema it points at", () => {
    const create = parsed.operations.find((one) => one.name === "createPayment");
    const body = create?.parameters.find((parameter) => parameter.in === "body");
    expect(body?.required).toBe(true);
    expect(body?.schema).toMatchObject({ type: "object", properties: { amount: { type: "number" } } });
  });

  it("requires every path parameter in the schema the model fills in", () => {
    const get = parsed.operations.find((one) => one.name === "getPayment");
    expect(get?.parametersJsonSchema).toMatchObject({ type: "object", required: ["paymentId"] });
    // `expand` is optional, so it is offered and not demanded.
    expect(Object.keys((get?.parametersJsonSchema as { properties: object }).properties)).toContain("expand");
  });

  it("marks only the reading methods read-only, which is what decides the tier", () => {
    expect(parsed.operations.find((one) => one.name === "getPayment")?.readOnly).toBe(true);
    expect(parsed.operations.find((one) => one.name === "cancelPayment")?.readOnly).toBe(false);
    expect(parsed.operations.find((one) => one.name === "createPayment")?.readOnly).toBe(false);
  });
});

describe("reading a Swagger 2 document", () => {
  const parsed = parseApiDocument(SWAGGER_2);

  it("builds the server URL from host, scheme and base path", () => {
    expect(parsed.serverUrl).toBe("https://legacy.example.com/api");
  });

  it("folds an `in: body` parameter into the same body parameter OpenAPI 3 produces", () => {
    const add = parsed.operations.find((one) => one.name === "addThing");
    const body = add?.parameters.find((parameter) => parameter.in === "body");
    expect(body?.name).toBe("body");
    expect(body?.schema).toMatchObject({ type: "object", properties: { label: { type: "string" } } });
  });
});

describe("a document that cannot be registered", () => {
  it("is refused when it is neither JSON nor YAML", () => {
    expect(() => parseApiDocument("this is: not: valid: yaml: at: all:")).toThrow(NotAnApiDocument);
  });

  it("is refused when it carries no openapi or swagger version", () => {
    expect(() => parseApiDocument(JSON.stringify({ paths: {} }))).toThrow(/openapi/);
  });

  it("is refused when it declares no operation, rather than registering an empty connector", () => {
    expect(() => parseApiDocument(JSON.stringify({ openapi: "3.0.0", paths: {} }))).toThrow(/no operation/);
  });

  it("leaves a deprecated operation out, and says it did", () => {
    const parsed = parseApiDocument(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "X" },
        servers: [{ url: "https://x.example.com" }],
        paths: {
          "/a": { get: { operationId: "a", responses: {} } },
          "/b": { get: { operationId: "b", deprecated: true, responses: {} } },
        },
      }),
    );
    expect(parsed.operations.map((one) => one.name)).toEqual(["a"]);
    expect(parsed.skipped.join(" ")).toContain("deprecated");
  });
});
