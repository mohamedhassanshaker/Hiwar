import { LogoMark } from "@/components/brand";

export const metadata = { title: "Brand" };

const COLOURS: [string, string, string][] = [
  ["Indigo ink", "#1B1F4B", "Brand base, headings, dark surfaces · 15.6:1 on white"],
  ["Indigo", "#4338CA", "Primary actions, links, selected states · 7.9:1 on white"],
  ["Indigo soft", "#EEF0FF", "Selected rows, AI messages, soft badges · background only"],
  ["Teal", "#14B8A6", "The second voice: logo accent, highlights · indigo ink text on it, 6.3:1"],
  ["Teal ink", "#0F766E", "Teal when it must be text · 5.5:1 on white"],
  ["Success", "#0E7A4F", "Live, resolved, ready · 5.4:1 on white"],
  ["Amber", "#F8B102", "Warnings and needs a person · text uses #8A5800"],
  ["Danger", "#C8261D", "Errors, destructive actions · 5.6:1 on white"],
];

/** The Brand sheet (PLT-002): logo option A, colour tokens and type. */
export default function BrandPage() {
  return (
    <div className="wrap col gap-24" style={{ paddingTop: 48 }}>
      <div className="col gap-8">
        <h1 className="h-sec">Hiwar brand</h1>
        <p className="lead">Hiwar means dialogue. The brand is built around two voices in one conversation: the AI and your team.</p>
      </div>
      <section className="row gap-24">
        {["#ffffff", "#1b1f4b", "#4338ca"].map((bg) => (
          <div key={bg} className="card p-24 row gap-12" style={{ background: bg }}>
            <LogoMark size={48} />
            <span className="h2" style={{ color: bg === "#ffffff" ? "#1b1f4b" : "#fff" }}>Hiwar</span>
            <span lang="ar" dir="rtl" style={{ fontFamily: "'IBM Plex Sans Arabic',sans-serif", fontWeight: 600, color: "#14b8a6" }}>حوار</span>
          </div>
        ))}
      </section>
      <p className="sm muted">Keep half the mark&apos;s height free on every side. Minimum size: 16 px for the mark alone, 80 px wide with the wordmark. Show حوار to the right of Hiwar in left-to-right layouts and to the left in Arabic layouts.</p>
      <section className="grid g4">
        {COLOURS.map(([name, hex, use]) => (
          <div key={name} className="card p-0" style={{ overflow: "hidden" }}>
            <div style={{ background: hex, height: 64 }} />
            <div className="p-12 col gap-2">
              <b>{name}</b>
              <span className="mono">{hex}</span>
              <span className="xs muted">{use}</span>
            </div>
          </div>
        ))}
      </section>
      <p className="sm">Inter for English and the interface; IBM Plex Sans Arabic for Arabic and right-to-left.</p>
    </div>
  );
}
