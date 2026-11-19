import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// Reading the catalogue pulls in the services behind every tool, which reach the session
// layer, which reaches Auth.js and the Next.js request. None of that exists in a Vitest
// process and none of it decides anything here.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => null,
}));

import { PLATFORM_TOOLS } from "@/mcp/tools";

/**
 * The platform MCP catalogue against what the harness actually calls.
 *
 * The agent service names each platform tool in a constant and calls it by that name. A
 * name the platform does not offer fails at run time, inside a Temporal activity, as a
 * `PlatformMcpError` the harness swallows — which is how `run_finish`, `approval_create`
 * and `agent_question_create` could all be missing while every test passed and every run
 * looked as though it had finished.
 *
 * Both sides are read as text rather than imported: the catalogue pulls in the services
 * behind every tool, and a contract check should not need an application to boot.
 */

const AGENT_SOURCE = join(process.cwd(), "..", "..", "services", "ai-agent", "src", "awp_agent");
const CATALOGUE = join(process.cwd(), "src", "mcp", "tools.ts");

/** Every `SOMETHING_TOOL = "name"` the agent service declares. */
/**
 * The tools the harness answers itself, from its own `HARNESS_RUN_TOOLS`.
 *
 * Read rather than restated: a second list here would be free to disagree with the one
 * the harness actually uses, which is the drift this whole suite exists to catch.
 */
function toolNamesTheHarnessAnswersItself(): string[] {
  const source = readFileSync(
    join(AGENT_SOURCE, "harness", "tools", "builtin.py"),
    "utf8",
  );
  const block = source.slice(source.indexOf("HARNESS_RUN_TOOLS"));
  const names = block.slice(0, block.indexOf(")")).matchAll(/([A-Z_]+)/g);
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/^([A-Z_]+) = "([a-z0-9_]+)"$/gm)) {
    constants.set(match[1], match[2]);
  }
  return [...names].map((match) => constants.get(match[1])).filter((name): name is string => !!name);
}

function toolNamesTheHarnessCalls(): string[] {
  const names = new Set<string>();
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".py")) continue;
      for (const match of readFileSync(path, "utf8").matchAll(/^[A-Z_]*TOOL = "([a-z0-9_]+)"$/gm)) {
        names.add(match[1]);
      }
    }
  };
  walk(AGENT_SOURCE);
  return [...names].sort();
}

/** Every tool the platform offers. */
function toolNamesThePlatformOffers(): string[] {
  const source = readFileSync(CATALOGUE, "utf8");
  return [...source.matchAll(/^\s*name: "([a-z0-9_]+)",$/gm)].map((match) => match[1]).sort();
}

/**
 * Tools the harness calls that the platform does not offer yet, and the milestone each
 * belongs to.
 *
 * Named rather than ignored: a run that calls one of these gets a swallowed error and
 * looks as though it worked, so what is not built has to be visible. The list only ever
 * shrinks — a new name appearing here fails the check instead.
 */
const NOT_BUILT_YET: Record<string, string> = {};

describe("the platform MCP catalogue", () => {
  it("offers every tool the agent service calls by name", () => {
    const called = toolNamesTheHarnessCalls();
    const offered = toolNamesThePlatformOffers();
    // A guard that found nothing to check has not checked anything.
    expect(called.length).toBeGreaterThan(0);
    expect(offered.length).toBeGreaterThan(0);

    // A tool the harness answers itself never reaches the platform MCP server, so the
    // catalogue must NOT offer it — `delegate_to_agent` starts a child mission inside
    // the workflow, and `knowledge_search` retrieves locally. The set is read from the
    // harness's own `HARNESS_RUN_TOOLS` rather than listed again here.
    const answeredByTheHarness = toolNamesTheHarnessAnswersItself();
    expect(answeredByTheHarness.length).toBeGreaterThan(0);

    const missing = called.filter(
      (name) =>
        !offered.includes(name) &&
        !answeredByTheHarness.includes(name) &&
        !(name in NOT_BUILT_YET),
    );
    expect({ called, missing }).toEqual({ called, missing: [] });
  });

  it("has nothing in the not-built list that is now built", () => {
    const offered = toolNamesThePlatformOffers();
    const stale = Object.keys(NOT_BUILT_YET).filter((name) => offered.includes(name));
    expect(stale).toEqual([]);
  });

  it("names each tool once", () => {
    const offered = toolNamesThePlatformOffers();
    expect(offered).toEqual([...new Set(offered)]);
  });
});

describe("the action tool registry", () => {
  it("derives a tier from the operation, so 200 tools are not 200 judgements", async () => {
    const { tierFor, toolName } = await import("@/mcp/action-tool");
    // A read changes nothing and runs unattended.
    expect(tierFor("list")).toBe("T0");
    expect(tierFor("get")).toBe("T0");
    // An ordinary write is confirmed.
    expect(tierFor("create")).toBe("T1");
    expect(tierFor("edit")).toBe("T1");
    // Taking something out of use, or into it, waits for a person.
    expect(tierFor("delete")).toBe("T2");
    expect(tierFor("publish")).toBe("T2");
    expect(tierFor("apply")).toBe("T2");
    expect(tierFor("rollback")).toBe("T2");
    // One vocabulary: a subject and an operation, so a model that has learnt one subject
    // can write the rest without being told each name.
    expect(toolName("request_type", "create")).toBe("request_type_create");
    expect(toolName("request_type_step", "delete")).toBe("request_type_step_delete");
  });

});

/**
 * Decision (e) as amended by D253: what an agent may do with authorisation.
 *
 * Every other safeguard (the grant on the token, the permission check at the service, the
 * bound approval) assumes the authorisation it reads was set by a person. So a tool that
 * changes an agent's configuration or grant, or what a public deployment lets a visitor
 * reach, is T2 and marked `authorisation`: a person other than the requester reads the
 * exact payload before it runs, in a room too. Connectors are managed the same way (D277),
 * except that no tool carries a credential. Roles and permissions, integration clients and
 * inviting a person stay outside the catalogue: each changes what every later call may do for
 * people, not agents, and D108 keeps them out.
 *
 * Two independent tests on each entry, because either alone is avoidable. The permission
 * is what the service actually checks; the name catches a tool that reaches the same
 * records behind a weaker-looking code. Reads are untouched.
 */

/** Permissions a service checks before it changes what an agent may do. */
const AGENT_AUTHORISATION_PERMISSIONS = new Set(["agents:write", "agents:publish", "agents:configure"]);

/** Connector writes that widen what agents may reach (D277); testing, refreshing and removing do not. */
const CONNECTOR_AUTHORISATION_NAMES = /^connector(_api|_activation|_tool)?_(create|edit)$/;
const CONNECTOR_HARMLESS = new Set(["connector_test_create", "connector_refresh_create"]);

/** Names that change an agent's authorisation, whatever permission they declare. */
const AGENT_AUTHORISATION_NAMES = [
  /^agent_(create|edit|delete|publish|rollback|configure|version|tool|grant|skill|knowledge|memory|trust|run_budget)/,
  /_grant(_|$)/,
  /^assistant_/,
];

/** Permissions and names no catalogue tool may carry at all (D108). */
const NEVER_PERMISSIONS = new Set(["permissions:write", "integrations:write"]);
const NEVER_NAMES = [/^role_(?!list$|get$)/, /^(permission|privilege)_/, /^person_(create|invitation)/];
/** D381, amending D108: deleting a person only takes a principal away, so it is offered at T2. */
const NARROWING_ONLY = new Set(["person_delete"]);

const isAgentAuthorisation = (entry: { name: string; permission: string }) =>
  AGENT_AUTHORISATION_PERMISSIONS.has(entry.permission) || AGENT_AUTHORISATION_NAMES.some((shape) => shape.test(entry.name));
const isNever = (entry: { name: string; permission: string }) =>
  !NARROWING_ONLY.has(entry.name) &&
  (NEVER_PERMISSIONS.has(entry.permission) || NEVER_NAMES.some((shape) => shape.test(entry.name)));

describe("D253 tools that change authorisation", () => {
  it("recognises them by permission or by name", () => {
    // Positive controls: without them the suite would pass on rules that match nothing.
    expect(isAgentAuthorisation({ name: "agent_tool_grant_edit", permission: "agents:invoke" })).toBe(true);
    expect(isAgentAuthorisation({ name: "agent_edit", permission: "agents:write" })).toBe(true);
    expect(isAgentAuthorisation({ name: "assistant_configure", permission: "agents:invoke" })).toBe(true);
    expect(isNever({ name: "role_edit", permission: "organisation:write" })).toBe(true);
    expect(isNever({ name: "integration_client_create", permission: "integrations:write" })).toBe(true);
    expect(isNever({ name: "person_create", permission: "organisation:write" })).toBe(true);

    expect(isAgentAuthorisation({ name: "agent_question_create", permission: "agents:invoke" })).toBe(false);
    expect(isAgentAuthorisation({ name: "agent_list", permission: "agents:read" })).toBe(false);
    expect(isNever({ name: "role_list", permission: "organisation:read" })).toBe(false);
    expect(isNever({ name: "work_item_edit", permission: "work_items:write" })).toBe(false);
  });

  it("offers an agent's configuration only at T2, decided by somebody other than the requester", () => {
    const offered = PLATFORM_TOOLS.filter(isAgentAuthorisation);
    // A catalogue that offered none has not exercised the rule.
    expect(offered.map((entry) => entry.name)).toContain("agent_tool_grant_edit");
    expect(offered.filter((entry) => entry.tier !== "T2" || entry.authorisation !== true).map((entry) => entry.name)).toEqual([]);
  });

  it("marks a lower-tier tool authorisation only where it escalates what it guards", () => {
    const loose = PLATFORM_TOOLS.filter((entry) => entry.authorisation && entry.tier !== "T2" && !entry.escalates);
    expect(loose.map((entry) => entry.name)).toEqual([]);
  });

  it("offers no role, permission, credential or invitation tool", () => {
    expect(PLATFORM_TOOLS.length).toBeGreaterThan(0);
    expect(PLATFORM_TOOLS.filter(isNever).map((entry) => entry.name)).toEqual([]);
    // The exception stays narrow: any other `permissions:write` tool is still refused.
    expect(isNever({ name: "person_suspend", permission: "permissions:write" })).toBe(true);
  });


  it("D277 offers the connector writes that widen access only at T2, decided by somebody else", () => {
    const writes = PLATFORM_TOOLS.filter((entry) => entry.permission === "connectors:write" && !CONNECTOR_HARMLESS.has(entry.name));
    expect(writes.map((entry) => entry.name).sort()).toEqual([
      "connector_activation_edit",
      "connector_api_create",
      "connector_create",
      "connector_delete",
      "connector_edit",
      "connector_tool_edit",
    ]);
    const widening = writes.filter((entry) => CONNECTOR_AUTHORISATION_NAMES.test(entry.name));
    expect(widening.filter((entry) => entry.tier !== "T2" || entry.authorisation !== true).map((entry) => entry.name)).toEqual([]);
    expect(writes.filter((entry) => entry.tier !== "T2").map((entry) => entry.name)).toEqual([]);
  });

  it("D277 takes no credential in any tool's input, so none passes through a model", async () => {
    const { inputSchemaOf } = await import("@/mcp/action-tool");
    const credential = /^(secret|password|token|api_?key|client_?secret|credential)s?$/i;
    const fields = (schema: unknown): string[] => {
      if (!schema || typeof schema !== "object") return [];
      const node = schema as Record<string, unknown>;
      const own = node.properties && typeof node.properties === "object" ? Object.keys(node.properties) : [];
      return [...own, ...Object.values(node).flatMap(fields)];
    };
    const carrying = PLATFORM_TOOLS.filter((entry) => fields(inputSchemaOf(entry)).some((name) => credential.test(name)));
    expect(carrying.map((entry) => entry.name)).toEqual([]);
    // The rule matches the field the console's own connector form carries.
    expect(credential.test("secret")).toBe(true);
  });
});

describe("the default grant", () => {
  it("is exactly the catalogue's reads and amendments, so nothing is granted by accident", async () => {
    // The list was twelve read-ish names while the catalogue grew to eighty-seven, so
    // "create a request type with these attributes" was answered with "I only read and
    // answer questions". The tools existed; nothing was granted them.
    //
    // Asserted rather than derived by import, because `run-payload.ts` importing the
    // catalogue would close a cycle through the services the catalogue calls. The test
    // is the enforcement: a tool added later fails here until somebody decides about
    // it, which is the right default for a grant.
    const { DEFAULT_PLATFORM_TOOLS, HARNESS_PLUMBING_TOOLS } = await import("@/features/agents/run-payload");
    const { BUILTIN_ONLY_PLATFORM_TOOLS } = await import("@/features/agents/default-tools");
    const { BUILTIN_DEFAULTS } = await import("@/features/agents/builtin");

    const plumbing = new Set<string>(HARNESS_PLUMBING_TOOLS);
    // D265: the deployment, storyline, room and schedule writes are the built-in Assistant's.
    const builtinOnly = new Set<string>(BUILTIN_ONLY_PLATFORM_TOOLS);
    const expected = PLATFORM_TOOLS.filter(
      (entry) =>
        (entry.tier === "T0" || entry.tier === "T1") &&
        !plumbing.has(entry.name) &&
        !builtinOnly.has(entry.name),
    )
      .map((entry) => entry.name)
      .sort();

    expect([...DEFAULT_PLATFORM_TOOLS].sort()).toEqual(expected);
    for (const name of BUILTIN_ONLY_PLATFORM_TOOLS) {
      expect(PLATFORM_TOOLS.find((entry) => entry.name === name)?.tier, name).toBe("T1");
      expect(BUILTIN_DEFAULTS.tools, name).toContain(name);
    }
  });

  it("D116 gives memory one agent write path (Hiwar has no work items)", () => {
    // A second tool for the same write is a second set of rules: memory_create let the model
    // name the scope D116 derives, and work_item_set_status bound no version and never escalated.
    const names = PLATFORM_TOOLS.map((entry) => entry.name);
    expect(names).toContain("memory_write");
    expect(names).not.toContain("memory_create");
    expect(names).toContain("knowledge_search");
    expect(names).not.toContain("knowledge_passage_search");
  });

  it("grants nothing that takes something out of use", async () => {
    // publish, delete, apply and rollback are grantable per agent, never given (D63).
    const { DEFAULT_PLATFORM_TOOLS } = await import("@/features/agents/run-payload");
    const tierOf = new Map(PLATFORM_TOOLS.map((entry) => [entry.name, entry.tier]));
    const dangerous = [...DEFAULT_PLATFORM_TOOLS].filter((name) => tierOf.get(name) === "T2");
    expect(dangerous).toEqual([]);
  });
});

describe("D253 a deployment save an agent makes", () => {
  it("waits for a person only when it changes who may reach what", async () => {
    const { exposureChanges } = await import("@/features/engage/tools");
    const current = {
      id: "shj",
      a: "def",
      surf: "Widget · WhatsApp",
      st: "Draft",
      allowedOrigins: ["https://a.example", "https://b.example"],
      visitorIdentity: "AnonymousOtpStepUp",
      visitorJwtFallback: "Anonymous",
      runAs: "p-1",
    } as unknown as Parameters<typeof exposureChanges>[1];
    const same = {
      code: "shj",
      defaultAgentCode: "def",
      status: "Draft",
      surfaces: ["WhatsApp", "Widget"],
      allowedOrigins: ["https://b.example", "https://a.example"],
      visitorIdentity: "AnonymousOtpStepUp",
      visitorJwtFallback: "Anonymous",
      accentColour: "#123456",
    } as unknown as Parameters<typeof exposureChanges>[0];

    // The same exposure in another order, with only the widget's look changed.
    expect(exposureChanges(same, current)).toEqual([]);
    expect(exposureChanges({ ...same, runAsPersonId: "p-1" }, current)).toEqual([]);

    expect(
      exposureChanges(
        {
          ...same,
          defaultAgentCode: "pa",
          status: "Enabled",
          surfaces: ["Widget"],
          allowedOrigins: ["null"],
          visitorIdentity: "SignedJwt",
          visitorJwtSecret: "s".repeat(16),
          runAsPersonId: "p-2",
        } as typeof same,
        current,
      ),
    ).toEqual(["defaultAgentCode", "status", "surfaces", "allowedOrigins", "visitorIdentity", "visitorJwtSecret", "runAsPersonId"]);
  });
});

describe("D254 the built-in Assistant's agent tools", () => {
  it("are catalogue tools that change an agent's authorisation, each T2 and decided by somebody else", async () => {
    const { BUILTIN_AGENT_TOOLS, BUILTIN_DEFAULTS } = await import("@/features/agents/builtin");
    const byName = new Map(PLATFORM_TOOLS.map((entry) => [entry.name, entry]));
    for (const name of BUILTIN_AGENT_TOOLS) {
      expect(byName.get(name)?.tier, name).toBe("T2");
      expect(byName.get(name)?.authorisation, name).toBe(true);
      expect(BUILTIN_DEFAULTS.tools, name).toContain(name);
    }
    // Every agent tool that writes, so the Assistant is not left with half a way to build one.
    const agentWrites = PLATFORM_TOOLS.filter((entry) => entry.name.startsWith("agent_") && entry.authorisation).map((entry) => entry.name);
    expect([...BUILTIN_AGENT_TOOLS].sort()).toEqual(agentWrites.sort());
  });
});

describe("D376 updating an installed skill", () => {
  it("is a T2 tool the built-in Assistant holds and no other agent is given by default", async () => {
    const { DEFAULT_PLATFORM_TOOLS } = await import("@/features/agents/run-payload");
    const { BUILTIN_DEFAULTS } = await import("@/features/agents/builtin");
    const tool = PLATFORM_TOOLS.find((entry) => entry.name === "skill_version_create");

    expect(tool?.tier).toBe("T2");
    expect(tool?.permission).toBe("skills:write");
    expect(BUILTIN_DEFAULTS.tools).toContain("skill_version_create");
    expect(DEFAULT_PLATFORM_TOOLS).not.toContain("skill_version_create");
  });

});
