import { describe, expect, it } from "vitest";

import { ATTACHMENT_PICKER_ACCEPT, attachmentRefusal } from "@/features/assistant/attachments";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads";

/** D239: what the assistant panel reads from an attached file, decided by its extension. */

describe("what the assistant panel reads", () => {
  it("reads zip, PDF, JSON, XLS, XLSX and PPTX, whatever their case", () => {
    for (const name of ["a.zip", "b.PDF", "c.json", "d.xls", "e.xlsx", "f.pptx", "g.Docx"]) {
      expect(attachmentRefusal(name, 10)).toBeNull();
    }
  });

  it("refuses a .ppt with the format to save it as, in both languages", () => {
    expect(attachmentRefusal("deck.ppt", 10)).toEqual({
      en: ".ppt files cannot be read. Save it as .pptx and attach it again.",
      ar: "لا يمكن قراءة ملفات .ppt. احفظه بصيغة .pptx ثم أرفقه مرة أخرى.",
    });
  });

  it("refuses an executable, a name with no extension, an empty file and one over the limit", () => {
    expect(attachmentRefusal("setup.exe", 10)?.en).toBe(".exe cannot be attached.");
    expect(attachmentRefusal("README", 10)?.en).toBe("That file type cannot be attached.");
    expect(attachmentRefusal("a.zip", 0)?.en).toBe("That file is empty.");
    expect(attachmentRefusal("a.zip", MAX_UPLOAD_BYTES + 1)?.en).toMatch(/over the \d+ MB limit/);
  });

  it("offers the readable types and .ppt in the file picker", () => {
    expect(ATTACHMENT_PICKER_ACCEPT.split(",")).toEqual(expect.arrayContaining([".zip", ".json", ".xls", ".ppt", ".pdf"]));
  });
});
