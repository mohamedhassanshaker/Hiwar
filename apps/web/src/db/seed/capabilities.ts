import { eq } from "drizzle-orm";

import type { Database } from "../client";
import * as s from "../schema";
import { CATALOG, CONNS0 } from "./data/connectors";
import { SKILLS } from "./data/skills";
import { shift } from "./clock";
import { ids } from "./ids";

/**
 * Data model sections 11 and 12: skills with their versions and scan results, and the
 * connectors, their catalogue entries and the tier every tool sits at.
 */

/** The prototype's source words, mapped to `SKILL_SOURCE_TYPES`. */
const SKILL_SOURCE: Record<string, string> = {
  Console: "Authored",
  Bundled: "Bundled",
  Git: "Git",
  Registry: "Registry",
};

/** The badge a skill carries is the state of its current version, not a column of its own. */
const SKILL_STATUS: Record<string, string> = {
  Installed: "Published",
  Bundled: "Published",
  "Pending scan": "Draft",
  Required: "Published",
  Deprecated: "Published",
};

/** The prototype's connector kinds, mapped to `CONNECTOR_TRANSPORTS`. */
const TRANSPORT: Record<string, string> = {
  "REST/OpenAPI": "StreamableHttp",
  "Remote MCP": "StreamableHttp",
  "Platform MCP": "StreamableHttp",
  "Local MCP (stdio)": "Stdio",
};

const CONNECTOR_AUTH: Record<string, string> = {
  "OAuth 2.1": "OAuth",
  "API key": "ApiKey",
  "Run token": "None",
  "—": "None",
};

const CONNECTOR_TITLES: Record<string, [string, string]> = {
  platform: ["Platform", "المنصة"],
  erp: ["Oracle ERP", "نظام ERP"],
  m365: ["Microsoft 365", "مايكروسوفت 365"],
  knowledge: ["Platform knowledge", "معرفة المنصة"],
  cards: ["Tahseel cards", "بطاقات تحصيل"],
  "sandbox-fs": ["Workbench file system", "نظام ملفات بيئة العمل"],
};

const TOOL_TITLES: Record<string, [string, string]> = {
  "claims.read": ["Read a claim", "قراءة مطالبة"],
  "claims.update_status": ["Change a claim status", "تغيير حالة مطالبة"],
  "purchase_order.submit": ["Submit a purchase order", "إرسال أمر شراء"],
  "vendors.search": ["Search vendors", "البحث عن الموردين"],
  "payments.release": ["Release a payment", "إطلاق دفعة"],
  "mail.read": ["Read mail", "قراءة البريد"],
  "mail.send": ["Send mail", "إرسال بريد"],
  "calendar.create_event": ["Create a calendar event", "إنشاء موعد"],
  "files.search": ["Search files", "البحث في الملفات"],
  search: ["Search knowledge", "البحث في قاعدة المعرفة"],
  "graph.query": ["Query the knowledge graph", "استعلام رسم المعرفة"],
  get_status: ["Read card status", "قراءة حالة البطاقة"],
  block: ["Block a card", "إيقاف بطاقة"],
  replace: ["Replace a card", "استبدال بطاقة"],
  read_file: ["Read a file", "قراءة ملف"],
  write_file: ["Write a file", "كتابة ملف"],
  delete_file: ["Delete a file", "حذف ملف"],
};

/**
 * Inserts the given skills, each with one current version and, unless pending a scan, a clean scan
 * result.
 */
export async function seedSkills(db: Database, skills: typeof SKILLS = SKILLS): Promise<void> {
  await db.insert(s.skill).values(
    skills.map((skill) => ({
      id: ids.skill(skill.n),
      skillName: skill.n,
      titleEn: skill.n.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      titleAr: skill.dAr.split("،")[0].slice(0, 60),
      descriptionEn: skill.d,
      descriptionAr: skill.dAr,
      sourceType: SKILL_SOURCE[skill.src],
      sourceUrl: skill.src === "Git" ? "https://git.tahseel.ae/skills/defect-report" : null,
      tags: skill.tags,
      authorPersonId: skill.src === "Console" ? ids.person("u4") : null,
    })),
  );

  await db.insert(s.skillVersion).values(
    skills.map((skill) => ({
      id: ids.skillVersion(skill.n),
      skillId: ids.skill(skill.n),
      versionLabel: skill.v,
      packageRef: `skills/${skill.n}/${skill.v}.zip`,
      checksum: `sha256:${skill.n}`,
      frontmatterValid: skill.b !== "Pending scan",
      declaredTools: skill.tools,
      status: SKILL_STATUS[skill.b],
    })),
  );

  for (const skill of skills) {
    await db.update(s.skill).set({ currentVersionId: ids.skillVersion(skill.n) }).where(eq(s.skill.id, ids.skill(skill.n)));
  }

  await db.insert(s.skillScanResult).values(
    skills
      .filter((skill) => skill.b !== "Pending scan")
      .map((skill) => ({
        skillVersionId: ids.skillVersion(skill.n),
        scripts: skill.n === "receipt-extraction" ? 2 : 0,
        networkCalls: 0,
        promptInjectionPatterns: 0,
        embeddedSecrets: 0,
        sandboxOnly: true,
        scannedAt: shift("2026-10-01T07:00:00Z"),
      })),
  );
}

/**
 * Inserts the whole discovery catalogue plus a catalogue entry, a connector and the tools for each
 * given connector. Every connector is stored with no credential, so its `authType` is None.
 */
export async function seedConnectors(db: Database, connectors: typeof CONNS0 = CONNS0): Promise<void> {
  await db.insert(s.connectorCatalogEntry).values([
    // What could be installed stays the full discovery list regardless of scope: browsing
    // the catalogue is not the same as one being live.
    ...CATALOG.map(([code, en, ar, kind, tools]) => ({
      id: ids.catalogEntry(code),
      nameEn: en.split(" — ")[0],
      nameAr: ar.split(" — ")[0],
      descriptionEn: en,
      descriptionAr: ar,
      logoRef: `catalogue/${code}.svg`,
      defaultUrl: kind === "Local MCP (stdio)" ? `stdio://${code}` : `https://mcp.${code}.example/mcp`,
      authType: kind === "Local MCP (stdio)" ? "None" : "OAuth",
      toolCount: tools,
    })),
    ...connectors.map((c) => ({
      id: ids.catalogEntry(c.n),
      nameEn: CONNECTOR_TITLES[c.n][0],
      nameAr: CONNECTOR_TITLES[c.n][1],
      descriptionEn: c.d,
      descriptionAr: c.dAr,
      logoRef: `catalogue/${c.n}.svg`,
      defaultUrl: c.url,
      authType: CONNECTOR_AUTH[c.auth],
      toolCount: c.tools.length,
    })),
  ]);

  await db.insert(s.connector).values(
    connectors.map((c) => ({
      id: ids.connector(c.n),
      code: c.n,
      // The built-in Platform connector is named; the others keep their code as their name.
      nameEn: c.n === "platform" ? CONNECTOR_TITLES.platform[0] : c.n,
      nameAr: c.n === "platform" ? CONNECTOR_TITLES.platform[1] : c.n,
      catalogEntryId: ids.catalogEntry(c.n),
      transport: TRANSPORT[c.kind],
      serverUrl: c.url,
      // The seed stores no credential, so a connector authenticates with none (D296); the
      // catalogue entry keeps the authentication it suggests.
      authType: "None",
      secretRef: null,
      defaultTierForNewTools: c.def,
      isEnabled: c.on,
      status: c.st === "Healthy" ? "Connected" : c.st === "Degraded" ? "Error" : "Disabled",
      lastHandshakeAt: shift("2026-10-09T10:30:00Z"),
      protocolVersion: "2025-06-18",
    })),
  );

  // The built-in Platform connector carries no tools of its own (D228), so a seed of it alone has none.
  const tools = connectors.flatMap((c) =>
    c.tools.map(([name, tier]) => ({
      id: ids.connectorTool(`${c.n}/${name}`),
      connectorId: ids.connector(c.n),
      name,
      titleEn: TOOL_TITLES[name][0],
      titleAr: TOOL_TITLES[name][1],
      descriptionEn: TOOL_TITLES[name][0],
      descriptionAr: TOOL_TITLES[name][1],
      readOnlyHint: tier === "T0",
      destructiveHint: tier === "T2" || tier === "T3",
      tier,
      isAvailable: c.st !== "Disabled",
    })),
  );
  if (tools.length > 0) await db.insert(s.connectorTool).values(tools);
}

/** Seeds every demo skill and connector. */
export async function seedCapabilities(db: Database): Promise<void> {
  await seedSkills(db);
  await seedConnectors(db);
}
