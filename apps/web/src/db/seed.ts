/**
 * PLT-006: the sample organization of the design, for demos and manual testing.
 * Idempotent: does nothing when the demo organization exists. Run with `npm run db:seed`.
 * Every demo account's password is `demo-password-1`, including the operator portal accounts.
 */
import { eq } from "drizzle-orm";

import { defaultAgentConfig } from "../server/agents";
import { hashPassword } from "../server/password";
import { ensurePlans, latestPlanVersion } from "../server/plans";
import { defaultDeploymentSettings } from "../server/visitor";
import { newPublicKey } from "../server/deployments";
import { db, pool, schema } from "./index";

const ORG = "Gulf Bites Restaurants (demo)";

/**
 * OPS-001 to OPS-011: Hiwar staff accounts for the operator portal at /ops, one per platform role.
 * Demo data only; a real account gets its role with `npm run ops:grant`. They set up 2-step
 * sign-in on their first visit to /ops, as every operator must.
 */
const OPERATORS: [string, string, "platform_admin" | "support_operator"][] = [
  ["Salma Platform Admin", "ops.admin.demo@hiwar.example", "platform_admin"],
  ["Omar Support Operator", "ops.support.demo@hiwar.example", "support_operator"],
];

async function seedOperators(): Promise<void> {
  const passwordHash = await hashPassword("demo-password-1");
  for (const [name, email, platformRole] of OPERATORS) {
    await db
      .insert(schema.users)
      .values({ name, email, passwordHash, emailVerifiedAt: new Date(), platformRole })
      .onConflictDoUpdate({ target: schema.users.email, set: { name, platformRole } });
  }
}

async function main() {
  await ensurePlans();
  await seedOperators();
  if (await db.query.organizations.findFirst({ where: eq(schema.organizations.name, ORG) })) {
    console.log("demo organization exists");
    return;
  }
  const growth = await latestPlanVersion("growth");
  const [org] = await db.insert(schema.organizations).values({ name: ORG, plan: "growth", status: "active", planVersionId: growth.id }).returning();
  const passwordHash = await hashPassword("demo-password-1");
  const people: [string, string, typeof schema.roleEnum.enumValues[number]][] = [
    ["Noura Al Suwaidi", "noura.demo@gulfbites.example", "owner"],
    ["Khalid Saeed", "khalid.demo@gulfbites.example", "support_agent"],
    ["Mariam Al Falasi", "mariam.demo@gulfbites.example", "builder"],
    ["Yousef Darwish", "yousef.demo@gulfbites.example", "analyst"],
    ["Huda Rahman", "huda.demo@gulfbites.example", "billing"],
  ];
  const users: Record<string, string> = {};
  for (const [name, email, role] of people) {
    const [user] = await db
      .insert(schema.users)
      .values({ name, email, passwordHash, emailVerifiedAt: new Date() })
      .onConflictDoUpdate({ target: schema.users.email, set: { name } })
      .returning();
    await db.insert(schema.members).values({ orgId: org.id, userId: user.id, role });
    users[name] = user.id;
  }

  const [faq] = await db
    .insert(schema.sources)
    .values({
      orgId: org.id,
      name: "Delivery and refunds FAQ",
      type: "faq",
      details: { question: "Do you deliver to Sharjah?", answer: "Yes. We deliver to Sharjah until midnight on weekdays and until 1 am on Fridays and Saturdays. Delivery is free above AED 60." },
    })
    .returning();

  const agents: { name: string; purpose: string; versions: number; instructions: string }[] = [
    { name: "Layla", purpose: "Customer support · Order site", versions: 7, instructions: "You are Layla, the friendly assistant for Gulf Bites Restaurants. Answer questions about the menu, allergens, delivery and orders using only the knowledge you are given. If you are not sure, say so and offer to connect the visitor to a person. Never promise refunds yourself. Always say you are an AI when asked." },
    { name: "Salim", purpose: "Lead capture · Catering page", versions: 3, instructions: "You are Salim. Help visitors planning events. Ask for the date, number of guests and budget, then capture the lead and tell them a person will send a quote within one working day." },
    { name: "Rana", purpose: "Appointment booking · Draft", versions: 0, instructions: "You help visitors book a table. Collect the date, time and party size, then confirm back before booking." },
  ];
  const agentIds: Record<string, string> = {};
  for (const a of agents) {
    const config = { ...defaultAgentConfig(a.name), purpose: a.purpose, instructions: a.instructions };
    const [row] = await db.insert(schema.agents).values({ orgId: org.id, draft: config, liveVersion: a.versions || null }).returning();
    agentIds[a.name] = row.id;
    for (let v = 1; v <= a.versions; v += 1) {
      await db.insert(schema.agentVersions).values({ orgId: org.id, agentId: row.id, number: v, config, publishedBy: users["Noura Al Suwaidi"] });
    }
  }

  const deployments: [string, string, "live" | "draft", number | null][] = [
    ["Order site · Dubai", "Layla", "live", null],
    ["Catering page", "Salim", "live", 3],
    ["Arabic landing page", "Layla", "draft", null],
  ];
  const depIds: Record<string, string> = {};
  for (const [name, agent, status, pinned] of deployments) {
    const [row] = await db
      .insert(schema.deployments)
      .values({ orgId: org.id, name, agentId: agentIds[agent], status, publicKey: newPublicKey(), settings: { ...defaultDeploymentSettings(), pinnedVersion: pinned } })
      .returning();
    depIds[name] = row.id;
    if (status === "live") {
      await db.insert(schema.origins).values({ orgId: org.id, deploymentId: row.id, origin: "https://gulfbites.example", checkUrl: "https://gulfbites.example/", verifiedAt: new Date() });
    }
  }

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const seed = async (
    name: string,
    language: "en" | "ar",
    deployment: string,
    state: "AI_ACTIVE" | "HANDOVER_PENDING" | "HUMAN_ACTIVE",
    version: number,
    owner: string | null,
    lines: [typeof schema.messageKindEnum.enumValues[number], string, string?][],
    history: [string, string][],
  ) => {
    const [c] = await db
      .insert(schema.conversations)
      .values({
        orgId: org.id,
        deploymentId: depIds[deployment],
        agentId: agentIds[deployment === "Catering page" ? "Salim" : "Layla"],
        agentVersion: deployment === "Catering page" ? 3 : 7,
        visitorToken: `demo-${name.replace(/\s/g, "-").toLowerCase()}-token`,
        visitor: { name, language, page: "gulfbites.example", device: "Desktop", country: "AE" },
        state,
        version,
        ownerUserId: owner ? users[owner] : null,
        waitingSince: state === "HANDOVER_PENDING" ? minutesAgo(1.67) : null,
        reasonCode: state === "HANDOVER_PENDING" ? "visitor_request" : null,
        handedOver: state !== "AI_ACTIVE",
        aiCounted: true,
      })
      .returning();
    for (const [i, [kind, text, author]] of lines.entries()) {
      await db.insert(schema.messages).values({ orgId: org.id, conversationId: c.id, kind, text, authorName: author ?? null, createdAt: minutesAgo(10 - i) });
    }
    for (const [i, [event, reason]] of history.entries()) {
      await db.insert(schema.ownershipEvents).values({ orgId: org.id, conversationId: c.id, event, actor: "seed", reasonCode: reason, version: i + 1, createdAt: minutesAgo(9 - i) });
    }
    await db.insert(schema.usageEvents).values({ orgId: org.id, deploymentId: c.deploymentId, conversationId: c.id, period: new Date().toISOString().slice(0, 7), costAed: "0.11" });
  };
  await seed("Omar Hassan", "en", "Order site · Dubai", "AI_ACTIVE", 1, null, [
    ["visitor", "Do you deliver to Sharjah after 10 pm?"],
    ["ai", "Yes. We deliver to Sharjah until midnight on weekdays and until 1 am on Fridays and Saturdays. Delivery is free above AED 60."],
    ["visitor", "And can I pay cash on delivery?"],
  ], [["AI took the conversation", "first visitor message"]]);
  await seed("Fatima Al Ketbi", "ar", "Order site · Dubai", "HANDOVER_PENDING", 2, null, [
    ["visitor", "السلام عليكم، وصلني الطلب ٤٨٢١ ناقص وأبغى استرجاع المبلغ"],
    ["ai", "وعليكم السلام فاطمة، آسفة على ما حصل. ممكن أعرف أي صنف كان ناقص؟"],
    ["visitor", "Two falafel wraps are missing. Refund AED 64 please, I want to talk to a person."],
    ["event", "Visitor asked for a person. Reason code: visitor_request. Staff notified."],
  ], [["AI took the conversation", "first visitor message"], ["Handover requested", "visitor_request"]]);
  await seed("Rashid Al Mazrouei", "en", "Catering page", "HUMAN_ACTIVE", 3, "Khalid Saeed", [
    ["visitor", "I need a quote for 120 guests on 5 December."],
    ["ai", "Happy to help. I have passed your request to our catering team so they can prepare a quote."],
    ["staff", "Hi Rashid, this is Khalid from catering. Do you need halal-certified buffet service with serving staff?", "Khalid Saeed"],
  ], [["AI took the conversation", "first visitor message"], ["Handover requested", "agent_request"], ["Khalid Saeed took over", "support_takeover"]]);

  console.log(`demo organization created: ${ORG}; sign in as noura.demo@gulfbites.example / demo-password-1 (operator portal: ops.admin.demo@hiwar.example); FAQ source ${faq.id} needs preparation (Retry in Knowledge)`);
}

await main();
await pool.end();
