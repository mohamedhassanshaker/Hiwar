// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Tabs } from "@/components/ui/tabs";
import { click, cleanup, mount } from "./dom";

afterEach(cleanup);

describe("NFR-17 a tab says whether it is selected", () => {
  it("marks only the current tab aria-selected, and follows a click", async () => {
    const items = [
      { id: "details", label: "Details" },
      { id: "history", label: "History & audit" },
    ];
    function Screen() {
      const [value, setValue] = useState("details");
      return <Tabs items={items} value={value} onChange={setValue} />;
    }
    const { container } = await mount(<Screen />);
    const selected = () => [...container.querySelectorAll("[role=tab]")].map((tab) => tab.getAttribute("aria-selected"));

    expect(selected()).toEqual(["true", "false"]);
    await click(container.querySelectorAll("[role=tab]")[1]);
    expect(selected()).toEqual(["false", "true"]);
  });
});
