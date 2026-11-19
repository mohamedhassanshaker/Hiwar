import Link from "next/link";

export const metadata = { title: { absolute: "Hiwar · AI assistants for your website" } };

const STEPS = [
  ["Subscribe", "Pick a plan and get your control panel."],
  ["Configure an agent", "Persona, instructions, knowledge, tools, guardrails and escalation rules."],
  ["Create a deployment", "Choose the sites, allowed domains, look and quotas."],
  ["Embed", "Paste one script tag. Check the install in a click."],
  ["Monitor and take over", "Watch every conversation live. Step in and hand back at any moment."],
];

const RULES = [
  "The AI never replies while a person owns the chat",
  "Messages that arrive during a handover reach exactly one party",
  "Staff see the AI reply in progress, the customer never does",
  "Handback notes stay private to your team",
];

const FEATURES = [
  ["i-bot", "Agents with versions", "Edit a draft, test it, publish, and roll back in one click."],
  ["i-database", "Your knowledge, cited", "Files, web pages and FAQs in Arabic and English, with sources shown to customers."],
  ["i-globe", "Deployments per site", "Each with its own key, allowed domains, look, quotas and agent version."],
  ["i-shield-check", "Guardrails and safe tools", "Topic limits, AI disclosure, and write tools that need confirmation or approval."],
  ["i-languages", "Arabic first", "Gulf, Egyptian and Levantine dialects, mixed text and full right-to-left."],
  ["i-chart", "Analytics and cost", "Resolution, escalation, wait times and cost per conversation."],
];

const SAFE = [
  "Each organization is isolated",
  "Guardrails on topics and replies",
  "Write tools ask first",
  "Secrets never reach the model",
  "Customer data is not used to train models",
  "An audit log of every change",
  "One owner per conversation",
];

/** W-Home (WEB-001). */
export default function HomePage() {
  return (
    <>
      <section className="wrap">
        <div className="split" style={{ paddingTop: 64, alignItems: "center" }}>
          <div className="wide col gap-16">
            <span className="over">Built for Arabic and English</span>
            <h1 style={{ fontSize: 42, lineHeight: "50px", fontWeight: 700, letterSpacing: "-.02em", color: "#1b1f4b" }}>
              A capable AI assistant on your website in minutes. Your team one click away.
            </h1>
            <p className="lead">
              Hiwar answers customers in their language, around the clock. You control what it knows and what it can do, watch every chat live, and step in at any moment.
            </p>
            <div className="row gap-8">
              <Link className="btn" href="/sign-up">Start free</Link>
              <Link className="btn outline" href="/conversations">See the control panel</Link>
            </div>
            <p lang="ar" dir="rtl" style={{ fontFamily: "'IBM Plex Sans Arabic',sans-serif", fontSize: 17, color: "#4338ca" }}>
              مساعد ذكي على موقعك خلال دقائق، وفريقك جاهز للتدخل في أي لحظة.
            </p>
          </div>
          <div className="narrow">
            <div className="card p-16 col gap-8">
              <div className="row between sm">
                <b>One line on your site</b>
                <span className="muted">Async, under 60 KB</span>
              </div>
              <pre className="snip" aria-label="Embed snippet">{`<script\n  src="https://cdn.your-domain.example/hiwar/widget.js"\n  data-deployment="pk_dep_XXXXXXXX"\n  async></script>`}</pre>
              <span className="xs muted">The widget is isolated from your page styles and loads without blocking it.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap sec" aria-labelledby="how">
        <h2 className="h-sec" id="how">From sign-up to live chat in five steps</h2>
        <div className="grid g5" style={{ marginTop: 24 }}>
          {STEPS.map(([t, d], i) => (
            <div key={t} className="stp">
              <span className="stn">{i + 1}</span>
              <b>{t}</b>
              <span className="sm muted">{d}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap sec" aria-labelledby="tk">
        <div className="split" style={{ alignItems: "center" }}>
          <div className="wide col gap-12">
            <span className="over">The signature feature</span>
            <h2 className="h-sec" id="tk">Take over any chat. Hand it back with context.</h2>
            <p className="lead">One owner at a time, so a customer never gets two replies. When your team steps in, the AI stops. When they hand back, the AI continues with a private summary.</p>
            <ul className="col gap-6" style={{ paddingInlineStart: 18 }}>
              {RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <Link href="/conversations">Try it in the inbox</Link>
          </div>
          <div className="narrow card p-20 col gap-12">
            <span className="over">A conversation&apos;s life</span>
            <div className="state">
              <span className="stt ai">With the AI</span>
              <span aria-hidden="true">→</span>
              <span className="stt warn">Waiting for a person</span>
              <span aria-hidden="true">→</span>
              <span className="stt ok">With a person</span>
              <span aria-hidden="true">→</span>
              <span className="stt ai">Handed back</span>
            </div>
            <span className="sm muted">Every change records who, when and why. Two people cannot claim the same chat.</span>
          </div>
        </div>
      </section>

      <section className="wrap sec" aria-labelledby="ft">
        <h2 className="h-sec" id="ft">Control without code</h2>
        <div className="grid g3" style={{ marginTop: 24 }}>
          {FEATURES.map(([icon, t, d]) => (
            <div key={t} className="card p-20 col gap-8">
              <i className={`i ${icon} s24 c-primary`} />
              <b>{t}</b>
              <span className="sm muted">{d}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap sec">
        <div className="card p-24 row between" style={{ background: "#1b1f4b", color: "#fff" }}>
          <div className="col gap-8">
            <h2 className="h-sec" style={{ color: "#fff" }}>Safe by design</h2>
            <p style={{ color: "#dfe2f0" }}>Your data stays yours.</p>
            <ul className="row gap-12" style={{ listStyle: "none", padding: 0, color: "#dfe2f0" }}>
              {SAFE.map((s) => (
                <li key={s} className="row gap-4 sm">
                  <i className="i i-check s14" style={{ color: "#14b8a6" }} /> {s}
                </li>
              ))}
            </ul>
          </div>
          <Link className="btn" href="/pricing" style={{ background: "#14b8a6", color: "#1b1f4b" }}>See plans</Link>
        </div>
      </section>
    </>
  );
}
