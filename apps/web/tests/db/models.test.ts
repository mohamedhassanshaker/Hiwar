import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-59 providers and connections, S-60 the routes agents call.
 *
 * The decisions here are about what a route is allowed to be, because a route that saves
 * and cannot serve is worse than one that was refused: an agent pinned to it fails on its
 * first model call, long after the mistake was made.
 */

// No egress proxy: the provider a connection test calls here is a server on this machine.
delete process.env.EGRESS_PROXY_URL;
process.env.APP_KEK ??= Buffer.alloc(32, 9).toString("base64");

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));
/** A step of a chat route, to build a chain of the kind most routes are (D290). */
const CHAT_STEP = `select rs.provider_id, rs.connection_id, rs.model_name from ai.route_step rs
  join ai.route r on r.id = rs.route_id where r.kind <> 'Decision' order by r.alias, rs.sort_order limit 1`;

describe.skipIf(!hasDatabase)("models and routes", () => {
  let ownerId = "";
  let memberId = "";

  const providerIdByName = async (name: string) => {
    const { rows } = await testPool().query<{ id: string }>(
      "select id from ai.model_provider where name_en = $1",
      [name],
    );
    return rows[0].id;
  };

  const connectionIdByName = async (name: string) => {
    const { rows } = await testPool().query<{ id: string }>(
      "select id from ai.provider_connection where name = $1 limit 1",
      [name],
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const member = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'layla@tahseel.ae'",
    );
    memberId = member.rows[0].id;
  });

  afterAll(async () => {
    await testPool().query("delete from ai.route where alias like 'tmp-%'");
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-59.1-03 a connection that authenticates as the gateway cannot be tested from here", async () => {
    const { untestableReason } = await import("@/lib/model-probe");

    // The identity belongs to the gateway's pod, not to this one, so there is nothing here
    // to authenticate with. Reporting a pass would be a lie about a credential never used.
    expect(untestableReason("Azure", "EntraId")).toMatch(/workload identity/);
    expect(untestableReason("Bedrock", "IamRole")).toMatch(/workload identity/);
    // Not an OpenAI wire format, so only the gateway knows how to call it.
    expect(untestableReason("Bedrock", "ApiKey")).toMatch(/OpenAI wire format/);
    expect(untestableReason("OpenAI", "ApiKey")).toBeNull();
    expect(untestableReason("Custom", "None")).toBeNull();
  });

  it("UC-59.1-07 a connection with no allowed models is refused a test", async () => {
    const { testConnection, ModelsRejected } = await import("@/features/models/service");
    signedInAs = ownerId;

    const connectionId = await connectionIdByName("Main");
    const kept = await testPool().query<{ model_name: string; modalities: string[] }>(
      "select model_name, modalities from ai.connection_allowed_model where connection_id = $1",
      [connectionId],
    );
    await testPool().query("delete from ai.connection_allowed_model where connection_id = $1", [connectionId]);

    await expect(testConnection(connectionId)).rejects.toBeInstanceOf(ModelsRejected);

    for (const row of kept.rows) {
      await testPool().query(
        "insert into ai.connection_allowed_model (connection_id, model_name, modalities) values ($1, $2, $3)",
        [connectionId, row.model_name, row.modalities],
      );
    }
  });

  it("UC-59.1-03 a connection reads Not checked until a test of the saved connection stores its outcome", async () => {
    const { addCustomProvider, loadModels, saveConnection, testConnection, testConnectionDraft } = await import(
      "@/features/models/service"
    );
    const { providerHealth } = await import("@/features/models/types");
    signedInAs = ownerId;

    // The provider: answers each completion with the next status queued, 200 when none is.
    const statuses: number[] = [];
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        const status = statuses.shift() ?? 200;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(status === 200 ? { choices: [] } : { error: { message: "upstream unavailable" } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

    const { providerId } = await addCustomProvider({ name: "tmp-health", engine: "vLLM", baseUrl, authType: "None", models: ["m-1"] });
    try {
      const { rows } = await testPool().query<{ id: string }>("select id from ai.provider_connection where provider_id = $1", [providerId]);
      const connectionId = rows[0].id;
      const read = async () => {
        const provider = (await loadModels()).providers.find((one) => one.id === providerId);
        if (!provider) throw new Error("tmp-health is not listed");
        return provider;
      };

      // Switched on is not the same as working.
      expect((await read()).conns[0]).toMatchObject({ st: "NotChecked", checkedAt: null, lastTest: [] });
      expect(providerHealth(await read())).toBe("NotChecked");

      // A draft test describes a configuration that may never be saved, so it stores nothing.
      const draft = await testConnectionDraft({ connectionId, provider: "Custom", baseUrl, authType: "None", models: [{ name: "m-1", kind: "Chat" }] });
      expect(draft.results.map((one) => one.ok)).toEqual([true]);
      expect((await read()).conns[0].st).toBe("NotChecked");

      statuses.push(503);
      const startedFailing = Date.now();
      await testConnection(connectionId);
      const failed = (await read()).conns[0];
      expect(failed.st).toBe("Failed");
      expect(Date.parse(failed.checkedAt ?? "")).toBeGreaterThanOrEqual(startedFailing);
      expect(failed.lastTest).toEqual([expect.objectContaining({ model: "m-1", ok: false, detail: expect.stringMatching(/^503: .*upstream unavailable/) })]);
      expect(providerHealth(await read())).toBe("Failed");

      const startedPassing = Date.now();
      await testConnection(connectionId);
      const passed = (await read()).conns[0];
      expect(passed.st).toBe("Healthy");
      expect(Date.parse(passed.checkedAt ?? "")).toBeGreaterThanOrEqual(startedPassing);
      expect(passed.lastTest).toEqual([expect.objectContaining({ model: "m-1", ok: true })]);
      expect(providerHealth(await read())).toBe("Healthy");

      // D196: an edited connection is not the one that was tested, so it reads Not checked again.
      await saveConnection({ providerId, connectionId, name: "tmp-health", baseUrl, authType: "None", active: true, allowedModels: ["m-1"], modelKinds: {}, contextWindows: {} });
      expect((await read()).conns[0]).toMatchObject({ st: "NotChecked", checkedAt: null, lastTest: [] });

      // Switched off reads as off, whatever the last test found.
      await saveConnection({ providerId, connectionId, name: "tmp-health", baseUrl, authType: "None", active: false, allowedModels: ["m-1"], modelKinds: {}, contextWindows: {} });
      expect((await read()).conns[0].st).toBe("Disabled");
      expect(providerHealth(await read())).toBe("Disabled");
    } finally {
      await testPool().query("delete from ai.model_provider where id = $1", [providerId]);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("UC-59.1-10 a connection a route still runs through is not removed", async () => {
    const { removeConnection, ModelsRejected } = await import("@/features/models/service");
    signedInAs = ownerId;

    const { rows } = await testPool().query<{ connection_id: string }>(
      "select connection_id from ai.route_step where connection_id is not null limit 1",
    );
    const inUse = rows[0].connection_id;

    // The routes are named so the admin can move them first, rather than finding a route
    // with a step pointing at a connection that no longer exists.
    await expect(removeConnection(inUse)).rejects.toMatchObject({
      name: "ModelsRejected",
      blockedBy: expect.arrayContaining([expect.any(String)]),
    });
    await expect(removeConnection(inUse)).rejects.toBeInstanceOf(ModelsRejected);

    const still = await testPool().query("select 1 from ai.provider_connection where id = $1", [inUse]);
    expect(still.rowCount).toBe(1);
  });

  it("UC-59.1-04 a provider that is off is not in the chain the gateway is given", async () => {
    const { readRouteForGateway } = await import("@/features/models/repository");

    const { rows } = await testPool().query<{ alias: string; provider_id: string }>(
      `select r.alias, rs.provider_id from ai.route r
       join ai.route_step rs on rs.route_id = r.id
       order by r.alias, rs.sort_order limit 1`,
    );
    const { alias, provider_id: providerId } = rows[0];

    const before = await readRouteForGateway(alias);
    expect(before?.steps.length).toBeGreaterThan(0);

    await testPool().query("update ai.model_provider set is_active = false where id = $1", [providerId]);
    const after = await readRouteForGateway(alias);
    // Either the route has fewer steps, or nothing left to serve at all — which is what
    // makes the gateway fall back rather than call a provider the platform disabled.
    expect((after?.steps.length ?? 0)).toBeLessThan(before?.steps.length ?? 0);

    await testPool().query("update ai.model_provider set is_active = true where id = $1", [providerId]);
  });

  it("UC-60.1-06 refuses a duplicate alias, an empty chain and a schema that is not one", async () => {
    const { saveRoute, ModelsRejected } = await import("@/features/models/service");
    const { saveRouteInput } = await import("@/features/models/schema");
    signedInAs = ownerId;

    const { rows } = await testPool().query<{ provider_id: string; connection_id: string; model_name: string }>(
      CHAT_STEP,
    );
    const step = {
      providerId: rows[0].provider_id,
      connectionId: rows[0].connection_id,
      modelName: rows[0].model_name,
    };

    // An alias is how an agent names a route, so two routes cannot share one.
    await expect(
      saveRoute({ alias: "small-fast", kind: "Standard", chain: [step] }),
    ).rejects.toBeInstanceOf(ModelsRejected);

    // A route with no chain has nothing to call; the schema refuses it before the service.
    expect(() => saveRouteInput.parse({ alias: "tmp-empty", chain: [] })).toThrow();

    // A typesafe route's schema is the contract it holds answers to.
    await expect(
      saveRoute({ alias: "tmp-bad-schema", kind: "Typesafe", outputSchema: "{not json", chain: [step] }),
    ).rejects.toThrow(/not valid JSON/);
    await expect(
      saveRoute({ alias: "tmp-bad-schema", kind: "Typesafe", outputSchema: '"a string"', chain: [step] }),
    ).rejects.toThrow(/not a JSON Schema/);
  });

  it("UC-60.1-07 refuses a model the chosen connection does not allow", async () => {
    const { saveRoute } = await import("@/features/models/service");
    signedInAs = ownerId;

    const { rows } = await testPool().query<{ provider_id: string; connection_id: string }>(
      "select provider_id, connection_id from ai.route_step limit 1",
    );

    // The editor does not offer it; the server refuses it as well, because a step naming a
    // model its connection does not allow is a route that saves and fails on first call.
    await expect(
      saveRoute({
        alias: "tmp-not-allowed",
        kind: "Standard",
        chain: [
          {
            providerId: rows[0].provider_id,
            connectionId: rows[0].connection_id,
            modelName: "a-model-nobody-allowed",
          },
        ],
      }),
    ).rejects.toThrow(/not allowed on that connection/);
  });

  it("D290 a decision model answers only on a Decision route, and a Decision route calls nothing else", async () => {
    const { saveRoute } = await import("@/features/models/service");
    signedInAs = ownerId;
    const { rows } = await testPool().query<{ provider_id: string; connection_id: string; model_name: string }>(CHAT_STEP);
    const chat = { providerId: rows[0].provider_id, connectionId: rows[0].connection_id, modelName: rows[0].model_name };
    const decider = { ...chat, modelName: "tmp/decider" };
    await testPool().query(
      "insert into ai.connection_allowed_model (connection_id, model_name, modalities, kind) values ($1, $2, '{text}', 'Decision')",
      [chat.connectionId, decider.modelName],
    );
    try {
      await expect(saveRoute({ alias: "tmp-decision-chat", kind: "Standard", chain: [decider] })).rejects.toThrow(
        /tmp\/decider is a decision model, which only a Decision route can call/,
      );
      await expect(saveRoute({ alias: "tmp-decision-chat", kind: "Decision", chain: [chat] })).rejects.toThrow(
        /is not a decision model/,
      );

      await saveRoute({ alias: "tmp-decision", kind: "Decision", chain: [decider] });
      const { readRouteForGateway } = await import("@/features/models/repository");
      expect(await readRouteForGateway("tmp-decision")).toMatchObject({ decision: true, steps: [{ model: "tmp/decider" }] });
    } finally {
      await testPool().query("delete from ai.route where alias = 'tmp-decision'");
      await testPool().query("delete from ai.connection_allowed_model where model_name = $1", [decider.modelName]);
    }
  });

  it("UC-60.1-05 realtime speech-to-speech refuses a model that carries no audio", async () => {
    const { saveRoute } = await import("@/features/models/service");
    signedInAs = ownerId;

    const textOnly = await testPool().query<{
      provider_id: string;
      connection_id: string;
      model_name: string;
    }>(
      `select pc.provider_id, am.connection_id, am.model_name
       from ai.connection_allowed_model am
       join ai.provider_connection pc on pc.id = am.connection_id
       where not ('audio' = any(am.modalities)) and am.kind <> 'Decision' limit 1`,
    );
    const audio = await testPool().query<{
      provider_id: string;
      connection_id: string;
      model_name: string;
    }>(
      `select pc.provider_id, am.connection_id, am.model_name
       from ai.connection_allowed_model am
       join ai.provider_connection pc on pc.id = am.connection_id
       where 'audio' = any(am.modalities) limit 1`,
    );
    if (textOnly.rowCount === 0 || audio.rowCount === 0) return;

    const asStep = (row: { provider_id: string; connection_id: string; model_name: string }) => ({
      providerId: row.provider_id,
      connectionId: row.connection_id,
      modelName: row.model_name,
    });

    await expect(
      saveRoute({
        alias: "tmp-voice",
        kind: "Voice",
        voiceMode: "Realtime",
        chain: [asStep(textOnly.rows[0])],
      }),
    ).rejects.toThrow(/realtime audio/);

    // The same route with a model that carries audio is accepted.
    await saveRoute({
      alias: "tmp-voice",
      kind: "Voice",
      voiceMode: "Realtime",
      sttModel: "",
      ttsVoice: "",
      languages: ["ar-AE"],
      bargeIn: true,
      maxCallMinutes: 15,
      chain: [asStep(audio.rows[0])],
    });

    const stored = await testPool().query<{ kind: string; voice_mode: string }>(
      "select kind, voice_mode from ai.route where alias = 'tmp-voice'",
    );
    expect(stored.rows[0]).toEqual({ kind: "Voice", voice_mode: "Realtime" });
  });

  it("UC-60.1-02 UC-60.1-03 a typesafe route keeps its schema, and a standard one drops it", async () => {
    const { saveRoute } = await import("@/features/models/service");
    signedInAs = ownerId;

    const { rows } = await testPool().query<{ provider_id: string; connection_id: string; model_name: string }>(
      CHAT_STEP,
    );
    const chain = [
      {
        providerId: rows[0].provider_id,
        connectionId: rows[0].connection_id,
        modelName: rows[0].model_name,
      },
    ];

    await saveRoute({
      alias: "tmp-typed",
      kind: "Typesafe",
      outputSchema: JSON.stringify({ type: "object", properties: { label: { type: "string" } } }),
      confidenceThreshold: 0.75,
      maxRetries: 3,
      chain,
    });
    const typed = await testPool().query<{ kind: string; output_schema_json: unknown; confidence_threshold: string }>(
      "select kind, output_schema_json, confidence_threshold from ai.route where alias = 'tmp-typed'",
    );
    expect(typed.rows[0].kind).toBe("Typesafe");
    expect(typed.rows[0].output_schema_json).toMatchObject({ type: "object" });
    expect(Number(typed.rows[0].confidence_threshold)).toBe(0.75);

    // Changed to Standard, the schema goes with it: a contract nothing enforces is worse
    // than none, because the screen would go on showing it.
    await saveRoute({ alias: "tmp-typed", originalAlias: "tmp-typed", kind: "Standard", chain });
    const plain = await testPool().query<{ kind: string; output_schema_json: unknown }>(
      "select kind, output_schema_json from ai.route where alias = 'tmp-typed'",
    );
    expect(plain.rows[0]).toEqual({ kind: "Standard", output_schema_json: null });
  });

  it("UC-60.1-04 a pipeline voice route keeps every setting a call needs", async () => {
    const { saveRoute } = await import("@/features/models/service");
    signedInAs = ownerId;

    const { rows } = await testPool().query<{ provider_id: string; connection_id: string; model_name: string }>(
      CHAT_STEP,
    );

    // Pipeline, not realtime: the model in the chain is the LLM in the middle, so a
    // text-only model is exactly right here and the speech steps are named beside it.
    await saveRoute({
      alias: "tmp-voice-pipeline",
      kind: "Voice",
      voiceMode: "Pipeline",
      sttModel: "gpt-4o-transcribe",
      ttsVoice: "gpt-4o-mini-tts · alloy",
      languages: ["ar-AE", "en-US"],
      bargeIn: true,
      maxCallMinutes: 20,
      chain: [
        {
          providerId: rows[0].provider_id,
          connectionId: rows[0].connection_id,
          modelName: rows[0].model_name,
        },
      ],
    });

    const stored = await testPool().query<{
      voice_mode: string;
      stt_model: string;
      tts_voice: string;
      languages: string[];
      barge_in: boolean;
      max_call_minutes: number;
    }>(
      `select voice_mode, stt_model, tts_voice, languages, barge_in, max_call_minutes
       from ai.route where alias = 'tmp-voice-pipeline'`,
    );
    expect(stored.rows[0]).toEqual({
      voice_mode: "Pipeline",
      stt_model: "gpt-4o-transcribe",
      tts_voice: "gpt-4o-mini-tts · alloy",
      languages: ["ar-AE", "en-US"],
      barge_in: true,
      max_call_minutes: 20,
    });
  });

  it("UC-60.1-08 renaming a route moves it rather than leaving two", async () => {
    const { saveRoute } = await import("@/features/models/service");
    signedInAs = ownerId;

    const { rows } = await testPool().query<{ provider_id: string; connection_id: string; model_name: string }>(
      CHAT_STEP,
    );
    const chain = [
      {
        providerId: rows[0].provider_id,
        connectionId: rows[0].connection_id,
        modelName: rows[0].model_name,
      },
    ];

    await saveRoute({ alias: "tmp-before", kind: "Standard", chain });
    await saveRoute({ alias: "tmp-after", originalAlias: "tmp-before", kind: "Standard", chain });

    const both = await testPool().query<{ alias: string }>(
      "select alias from ai.route where alias in ('tmp-before', 'tmp-after')",
    );
    expect(both.rows.map((row) => row.alias)).toEqual(["tmp-after"]);
  });

  it("UC-60.1-09 a route an agent is pinned to is not deleted", async () => {
    const { removeRoute, ModelsRejected } = await import("@/features/models/service");
    signedInAs = ownerId;

    const { rows } = await testPool().query<{ alias: string }>(
      `select r.alias from ai.route r
       join ai.agent_version av on av.primary_route_id = r.id
       where av.is_active limit 1`,
    );
    if (rows.length === 0) return;

    await expect(removeRoute(rows[0].alias)).rejects.toBeInstanceOf(ModelsRejected);
    const still = await testPool().query("select 1 from ai.route where alias = $1", [rows[0].alias]);
    expect(still.rowCount).toBe(1);
  });

  // Each of these is a route the database would refuse to delete anyway; the refusal has to
  // name the users instead of surfacing as an unexpected foreign-key error.
  it.each([
    ["an agent version's fallback route", "join ai.agent_version u on u.fallback_route_id = r.id"],
    ["an agent budget's cheaper route", "join gov.agent_budget u on u.cheaper_route_id = r.id"],
    [
      "a collection's embedding or extraction route",
      `join ai.knowledge_collection u on u.models_config_json ->> 'embeddingRoute' = r.alias
         or u.models_config_json ->> 'extractionRoute' = r.alias`,
    ],
  ])("UC-60.1-09 a route used as %s is refused with its users named", async (_label, join) => {
    const { removeRoute, ModelsRejected } = await import("@/features/models/service");
    signedInAs = ownerId;

    const { rows } = await testPool().query<{ alias: string }>(`select r.alias from ai.route r ${join} limit 1`);
    if (rows.length === 0) return;

    const refusal = await removeRoute(rows[0].alias).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ModelsRejected);
    expect((refusal as InstanceType<typeof ModelsRejected>).blockedBy.length).toBeGreaterThan(0);
    const still = await testPool().query("select 1 from ai.route where alias = $1", [rows[0].alias]);
    expect(still.rowCount).toBe(1);
  });

  it("UC-60.1-09 a route nothing calls is deleted with its chain", async () => {
    const { saveRoute, removeRoute } = await import("@/features/models/service");
    signedInAs = ownerId;

    const { rows } = await testPool().query<{ provider_id: string; connection_id: string; model_name: string }>(
      CHAT_STEP,
    );
    await saveRoute({
      alias: "tmp-unused",
      kind: "Standard",
      chain: [
        {
          providerId: rows[0].provider_id,
          connectionId: rows[0].connection_id,
          modelName: rows[0].model_name,
        },
      ],
    });

    await removeRoute("tmp-unused");
    const gone = await testPool().query("select 1 from ai.route where alias = 'tmp-unused'");
    expect(gone.rowCount).toBe(0);
  });

  it("a step's Secret is named by its own connection, not a shared bootstrap Secret", async () => {
    const { readRouteForGateway } = await import("@/features/models/repository");
    const { connectionSecretName } = await import("@/agentgateway/secrets");

    const { rows } = await testPool().query<{ alias: string }>(
      `select r.alias from ai.route r
       join ai.route_step rs on rs.route_id = r.id
       where rs.connection_id is not null limit 1`,
    );
    const renderable = await readRouteForGateway(rows[0].alias);
    expect(renderable?.steps.length).toBeGreaterThan(0);

    for (const step of renderable?.steps ?? []) {
      // Every step's Secret is derived from its own connection id, so saving a different
      // connection's credential can never land in another step's Secret.
      expect(step.secretName).not.toBe("agentgateway-providers");
      expect(step.secretName.startsWith("provider-conn-")).toBe(true);
    }

    const { rows: stepRows } = await testPool().query<{ connection_id: string }>(
      `select rs.connection_id from ai.route r
       join ai.route_step rs on rs.route_id = r.id
       where r.alias = $1 limit 1`,
      [rows[0].alias],
    );
    expect(renderable?.steps[0].secretName).toBe(connectionSecretName(stepRows[0].connection_id));
  });

  it("UC-59.1-05 adds a provider agentgateway already speaks to natively, without seed data", async () => {
    const { addCloudProvider } = await import("@/features/models/service");
    signedInAs = ownerId;

    const { providerId } = await addCloudProvider({
      name: "tmp-cloud-anthropic",
      gatewayProvider: "Anthropic",
      authType: "ApiKey",
      secret: "sk-test",
      models: ["claude-test"],
    });

    const { rows } = await testPool().query<{ kind: string; gateway_provider: string; engine: string | null }>(
      "select kind, gateway_provider, engine from ai.model_provider where id = $1",
      [providerId],
    );
    expect(rows[0]).toEqual({ kind: "Cloud", gateway_provider: "Anthropic", engine: null });

    await testPool().query("delete from ai.model_provider where id = $1", [providerId]);
  });

  it("UC-59.1-05 a self-hosted engine other than Ollama saves without violating its own check constraint", async () => {
    const { addCustomProvider } = await import("@/features/models/service");
    signedInAs = ownerId;

    // `ENGINES` offers the display label ("vLLM"); the database holds its own identity
    // ("VLlm", `MODEL_ENGINES`). Passing the label straight through violates
    // `model_provider_engine_check` on save — this proves the translation actually happens.
    const { providerId } = await addCustomProvider({
      name: "tmp-engine-vllm",
      engine: "vLLM",
      baseUrl: "http://host:8000/v1",
      authType: "None",
      models: ["llama-3"],
    });

    const { rows } = await testPool().query<{ engine: string }>(
      "select engine from ai.model_provider where id = $1",
      [providerId],
    );
    expect(rows[0].engine).toBe("VLlm");

    await testPool().query("delete from ai.model_provider where id = $1", [providerId]);
  });

  it("UC-59.1-05 OpenRouter is offered as an OpenAI-compatible engine, not a native cloud provider", async () => {
    const { addCloudProviderInput } = await import("@/features/models/schema");

    // OpenRouter is an aggregator over many vendors' models, not a distinct wire protocol
    // agentgateway has a native adapter for — the demo seed itself wires it as a self-hosted
    // OpenAI-compatible engine with a real base URL, never as a bare gateway identity.
    expect(() => addCloudProviderInput.parse({ name: "x", gatewayProvider: "Openrouter", models: ["m"] })).toThrow();
  });

  it("UC-59.1-05 refuses a cloud provider that needs an endpoint it was not given", async () => {
    const { addCloudProvider, ModelsRejected } = await import("@/features/models/service");
    signedInAs = ownerId;

    await expect(
      addCloudProvider({
        name: "tmp-cloud-azure",
        gatewayProvider: "Azure",
        authType: "ApiKey",
        secret: "sk-test",
        models: ["gpt-4.1"],
      }),
    ).rejects.toBeInstanceOf(ModelsRejected);
  });

  it("UC-59.1-09 refuses every provider change to someone who may not make one", async () => {
    const { setProviderActive, saveRoute, removeConnection } = await import("@/features/models/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = memberId;

    const providerId = await providerIdByName("OpenAI");
    await expect(setProviderActive(providerId, false)).rejects.toBeInstanceOf(NotPermitted);
    await expect(removeConnection(await connectionIdByName("Main"))).rejects.toBeInstanceOf(NotPermitted);
    await expect(
      saveRoute({ alias: "tmp-denied", kind: "Standard", chain: [] as never }),
    ).rejects.toBeInstanceOf(NotPermitted);
  });
  it("S-59 S-60 reads every provider and route for somebody who may see them", async () => {
    const { loadModels } = await import("@/features/models/service");
    signedInAs = ownerId;
    const { providers, routes } = await loadModels();
    const counts = await testPool().query<{ providers: number; routes: number }>(
      "select (select count(*)::int from ai.model_provider) as providers, (select count(*)::int from ai.route) as routes",
    );
    expect(providers.length).toBe(counts.rows[0].providers);
    expect(routes.length).toBe(counts.rows[0].routes);
  });

  it("UC-59.1-07 refuses to test a draft connection that allows no model", async () => {
    const { testConnectionDraft, ModelsRejected } = await import("@/features/models/service");
    signedInAs = ownerId;
    await expect(
      testConnectionDraft({ provider: "OpenAI", baseUrl: "https://api.example.test/v1", authType: "ApiKey", models: [] }),
    ).rejects.toBeInstanceOf(ModelsRejected);
  });

  it("UC-59.1-03 says a draft connection on a workload identity cannot be tested from here", async () => {
    const { testConnectionDraft } = await import("@/features/models/service");
    signedInAs = ownerId;
    const outcome = await testConnectionDraft({
      provider: "Azure",
      baseUrl: "https://example.openai.azure.test",
      authType: "EntraId",
      models: [{ name: "gpt-4o", kind: "Chat" }],
    });
    expect(outcome.results).toEqual([]);
    expect(outcome.untestable).toMatch(/workload identity/);
  });

  it("UC-59.1-09 refuses a draft connection test to somebody without models:write", async () => {
    const { testConnectionDraft } = await import("@/features/models/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = memberId;
    await expect(
      testConnectionDraft({ provider: "Custom", baseUrl: "http://host:8000/v1", authType: "None", models: [{ name: "m", kind: "Chat" }] }),
    ).rejects.toBeInstanceOf(NotPermitted);
  });

  it("UC-59.1-06 reports an engine it cannot reach as a refusal the form can show", async () => {
    const { discoverEngineModels, ModelsRejected } = await import("@/features/models/service");
    signedInAs = ownerId;
    await expect(discoverEngineModels({ baseUrl: "http://127.0.0.1:1/v1", authType: "None" })).rejects.toBeInstanceOf(ModelsRejected);
  });

  it("UC-59.1-05 renames a connection and removes a provider no route uses, auditing both", async () => {
    const { addCustomProvider, saveConnection, removeProvider } = await import("@/features/models/service");
    signedInAs = ownerId;
    const { providerId } = await addCustomProvider({
      name: "tmp-engine-removable",
      engine: "Ollama",
      baseUrl: "http://localhost:11434",
      authType: "None",
      models: ["llama-3"],
    });
    const connection = await testPool().query<{ id: string }>(
      "select id from ai.provider_connection where provider_id = $1",
      [providerId],
    );
    const connectionId = connection.rows[0].id;

    await saveConnection({
      providerId,
      connectionId,
      name: "tmp-renamed",
      baseUrl: "http://localhost:11434",
      authType: "None",
      active: true,
      allowedModels: ["llama-3"],
      modelKinds: {},
      contextWindows: {},
    });
    const renamed = await testPool().query<{ name: string }>("select name from ai.provider_connection where id = $1", [connectionId]);
    expect(renamed.rows[0].name).toBe("tmp-renamed");
    const saved = await testPool().query<{ action: string; detail: unknown }>(
      "select action, detail_json as detail from audit.audit_entry where object_label = 'tmp-renamed' order by at desc, id desc limit 1",
    );
    expect(saved.rows[0]).toEqual({ action: "models:connection", detail: { authType: "None", secretChanged: false } });

    await removeProvider(providerId);
    const gone = await testPool().query("select 1 from ai.model_provider where id = $1", [providerId]);
    expect(gone.rowCount).toBe(0);
    const removed = await testPool().query<{ detail: unknown }>(
      "select detail_json as detail from audit.audit_entry where object_id = $1 order by at desc, id desc limit 1",
      [providerId],
    );
    expect(removed.rows[0].detail).toEqual({ removed: true });
  });

  it("UC-60.1-05 stores each allowed model's context window and reads it back", async () => {
    const { addCustomProvider, loadModels, saveConnection, removeProvider } = await import("@/features/models/service");
    signedInAs = ownerId;
    const { providerId } = await addCustomProvider({
      name: "tmp-engine-windows",
      engine: "Ollama",
      baseUrl: "http://localhost:11434",
      authType: "None",
      models: ["small", "large"],
    });
    const connection = await testPool().query<{ id: string }>(
      "select id from ai.provider_connection where provider_id = $1",
      [providerId],
    );
    const connectionId = connection.rows[0].id;

    await saveConnection({
      providerId,
      connectionId,
      name: "tmp-windows",
      baseUrl: "http://localhost:11434",
      authType: "None",
      active: true,
      allowedModels: ["small", "large"],
      modelKinds: {},
      contextWindows: { small: 4096 },
    });
    const { providers } = await loadModels();
    const saved = providers.find((provider) => provider.id === providerId)?.conns.find((one) => one.id === connectionId);
    // A model given no window has none recorded, rather than some default.
    expect(saved?.windows).toEqual({ small: 4096 });

    await removeProvider(providerId);
  });

  it("UC-59.1-05 refuses to remove a provider a route still chains through", async () => {
    const { removeProvider, ModelsRejected } = await import("@/features/models/service");
    signedInAs = ownerId;
    const used = await testPool().query<{ id: string }>(
      `select provider_id as id from ai.route_step order by provider_id limit 1`,
    );
    await expect(removeProvider(used.rows[0].id)).rejects.toBeInstanceOf(ModelsRejected);
  });

  it("republishes every route that can be rendered, and none fails where there is no gateway to apply to", async () => {
    const { republishRoutes } = await import("@/features/models/service");
    const outcome = await republishRoutes();
    expect(outcome.failed).toEqual([]);
    const aliases = await testPool().query<{ alias: string }>("select alias from ai.route");
    expect(outcome.published.every((alias) => aliases.rows.some((row) => row.alias === alias))).toBe(true);
  });
});
