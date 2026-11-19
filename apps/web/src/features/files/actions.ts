"use server";

import type { Outcome } from "@/lib/outcome";

/** The assistant's "keep this file" step. Hiwar has no file library, so the file is not stored. */
export async function uploadFile(_input: unknown): Promise<Outcome<{ id: string; name: string; quarantined: string | null }>> {
  return { ok: false, reason: "Hiwar has no file library; the file was read but not stored.", reasonAr: "لا توجد مكتبة ملفات في حوار؛ قُرئ الملف ولم يُحفظ." };
}
