import { MAX_UPLOAD_BYTES, type UploadRefusal } from "@/lib/uploads";

/**
 * D239: what the assistant panel reads from an attached file.
 *
 * Wider than the file store's allow-list (`lib/uploads.ts`): a `.zip`, `.json` or `.xls` is read
 * for the question but not kept as a file, because the store keeps no archives (owner,
 * 2026-11-02). Decided by extension, as the agent service's parser decides, because a browser
 * declares a zip as anything from `application/zip` to `application/octet-stream`.
 */
export const READABLE_EXTENSIONS = [
  ".pdf", ".docx", ".xlsx", ".xls", ".pptx", ".json", ".zip", ".txt", ".csv", ".md", ".html",
  ".png", ".jpg", ".jpeg", ".webp",
];

/** Office 97–2003 formats nothing reads, with the format to save them as (ADR-0002). */
const SAVE_AS: Record<string, string> = { ".ppt": ".pptx" };

/** The picker's filter: what can be read, and `.ppt` so picking one says what to do. */
export const ATTACHMENT_PICKER_ACCEPT = [...READABLE_EXTENSIONS, ...Object.keys(SAVE_AS)].join(",");

/** Why the panel will not read a file, or null when it will. */
export function attachmentRefusal(name: string, size: number): UploadRefusal | null {
  const extension = /\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? "";
  const saveAs = SAVE_AS[extension];
  if (saveAs) {
    return {
      en: `${extension} files cannot be read. Save it as ${saveAs} and attach it again.`,
      ar: `لا يمكن قراءة ملفات ${extension}. احفظه بصيغة ${saveAs} ثم أرفقه مرة أخرى.`,
    };
  }
  if (!READABLE_EXTENSIONS.includes(extension)) {
    return { en: `${extension || "That file type"} cannot be attached.`, ar: `${extension || "هذا النوع من الملفات"} لا يمكن إرفاقه.` };
  }
  if (size <= 0) return { en: "That file is empty.", ar: "هذا الملف فارغ." };
  if (size > MAX_UPLOAD_BYTES) {
    const limit = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    return { en: `That file is over the ${limit} MB limit.`, ar: `هذا الملف يتجاوز حد ${limit} ميجابايت.` };
  }
  return null;
}
