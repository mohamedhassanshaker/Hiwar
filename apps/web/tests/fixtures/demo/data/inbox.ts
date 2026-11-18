/** The prototype's inbox rows. */
type InboxItemSeed = {
  id: number;
  kind: string;
  risk?: string;
  from: string;
  t: string;
  tAr: string;
  time: string;
  tool?: string;
  args?: string;
};

export const INBOX: InboxItemSeed[] = [
  { id: 1, kind: 'approval', risk: 'High', from: 'prc', t: 'Send purchase order PO-7781 to Gulf IT', tAr: 'إرسال أمر الشراء PO-7781 إلى الخليج للتقنية', time: '08:52', tool: 'erp/purchase_order.submit', args: '{ "vendor": "Gulf IT LLC", "lines": 3, "total_aed": 148500.00, "cost_center": "IT-OPS" }' },
  { id: 2, kind: 'approval', risk: 'Medium', from: 'exp', t: 'Flag 19 September claims for review under the Q4 per-diem', tAr: 'وضع 19 مطالبة من سبتمبر قيد المراجعة وفق البدل اليومي للربع الرابع', time: '09:21', tool: 'erp/claims.update_status', args: '{ "claims": 19, "status": "Under review" }' },
  { id: 3, kind: 'question', from: 'exp', t: 'Is a taxi receipt without VAT number acceptable?', tAr: 'هل إيصال سيارة الأجرة بدون رقم ضريبي مقبول؟', time: '09:40' },
  { id: 4, kind: 'mention', from: 'u2', t: 'Mentioned you in SES-1041', tAr: 'أشار إليك في SES-1041', time: '10:02' },
  { id: 5, kind: 'sla', from: 'bug', t: 'BUG-311 breaches SLA in 3h 10m', tAr: 'BUG-311 سيتجاوز اتفاقية الخدمة خلال 3س 10د', time: '10:15' },
  { id: 6, kind: 'review', from: 'prc', t: 'Review request: TSK-2311 vendor comparison', tAr: 'طلب مراجعة: TSK-2311 مقارنة الموردين', time: 'Yesterday' },
];
