import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useClientNow } from "@/hooks/use-client-now";

/** The words a dashboard greeting would read off the clock, as the server renders them. */
function Greeting() {
  const now = useClientNow();
  return <h1>{now ? (now.getHours() < 12 ? "Good morning" : "Good evening") : "Welcome"}</h1>;
}

describe("the client's clock", () => {
  afterEach(() => vi.useRealTimers());

  it("D160 is not read while the server renders, so the page does not depend on the server's time of day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T06:00:00Z"));
    const morning = renderToString(<Greeting />);
    vi.setSystemTime(new Date("2026-10-20T20:57:00Z"));
    const evening = renderToString(<Greeting />);
    // What the browser hydrates against is the same whatever the hour, and in any time zone.
    expect(morning).toBe(evening);
    expect(morning).toContain("Welcome");
  });
});

describe("a chart's last day", () => {
  it("D160 is called Today only from the browser's clock, never from the server's", async () => {
    const { bucketLabel, isoDay } = await import("@/features/home/components/dash3/range");
    const t = (en: string) => en;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = new Date();
    const start = `${isoDay(today)}T00:00:00`;
    expect(bucketLabel(start, "day", true, t, "en-GB", zone, null)).not.toBe("Today");
    expect(bucketLabel(start, "day", true, t, "en-GB", zone, today)).toBe("Today");
  });

  describe("D365 names a bucket by the organisation's day, not the runtime's", () => {
    const original = process.env.TZ;
    afterEach(() => {
      process.env.TZ = original;
    });

    it("should_label_a_dubai_day_alike_on_a_utc_server_and_a_dubai_browser", async () => {
      const { bucketLabel } = await import("@/features/home/components/dash3/range");
      const t = (en: string) => en;
      // Friday 30 October 2026 starts at 20:00 UTC on the Thursday, in Asia/Dubai.
      const start = "2026-10-29T20:00:00.000Z";
      const label = (runtimeZone: string) => {
        process.env.TZ = runtimeZone;
        return ["day", "week", "month"].map((unit) => bucketLabel(start, unit, false, t, "en-GB", "Asia/Dubai", null));
      };
      const server = label("UTC");
      const browser = label("Asia/Dubai");
      expect(server).toEqual(browser);
      expect(server).toEqual(["Fri", "30 Oct", "Oct"]);
    });
  });
});
