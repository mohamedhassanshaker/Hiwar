import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { db, schema } from "@/db";
import { handle, Refused } from "@/server/api";
import { PLAN_LABEL } from "@/server/plans";
import { apiMember } from "@/server/session";

/** BIL-001 FR-022: the invoice as PDF, with plan, overage, 5% VAT and total. */
export const GET = handle(async (_: Request, { params }: { params: Promise<{ id: string }> }) => {
  const member = await apiMember("billing");
  const { id } = await params;
  const invoice = await db.query.invoices.findFirst({ where: and(eq(schema.invoices.id, id), eq(schema.invoices.orgId, member.org.id)) });
  if (!invoice) throw new Refused("This invoice does not exist.", 404);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.106, 0.122, 0.294);
  let y = 780;
  const line = (text: string, opts: { size?: number; b?: boolean; x?: number } = {}) => {
    page.drawText(text, { x: opts.x ?? 56, y, size: opts.size ?? 11, font: opts.b ? bold : font, color: ink });
  };
  const day = (d: Date) => d.toISOString().slice(0, 10);
  line("Hiwar", { size: 22, b: true });
  y -= 36;
  line(`Invoice ${invoice.number}`, { size: 16, b: true });
  y -= 22;
  line(`Billed to: ${member.org.name}`);
  y -= 16;
  line(`Period: ${day(invoice.periodStart)} to ${day(new Date(invoice.periodEnd.getTime() - 86_400_000))}`);
  y -= 16;
  line(`Status: ${invoice.status === "paid" ? "Paid" : invoice.status === "open" ? "Open" : invoice.status}`);
  y -= 40;
  const rows: [string, string][] = [
    [`${PLAN_LABEL[invoice.plan]} plan`, `AED ${invoice.planAmountAed}`],
    [`Overage: ${invoice.overageCount} AI conversations`, `AED ${invoice.overageAmountAed}`],
    ["VAT 5%", `AED ${invoice.vatAed}`],
  ];
  for (const [label, amount] of rows) {
    line(label);
    line(amount, { x: 420 });
    y -= 20;
  }
  y -= 6;
  page.drawLine({ start: { x: 56, y: y + 14 }, end: { x: 539, y: y + 14 }, thickness: 0.5, color: ink });
  line("Total", { b: true });
  line(`AED ${invoice.totalAed}`, { x: 420, b: true });
  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${invoice.number}.pdf"` },
  });
});
