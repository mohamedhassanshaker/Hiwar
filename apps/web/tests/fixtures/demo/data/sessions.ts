/** The prototype's room rows. `last` is how long ago the room was last active. */
type SessionSeed = {
  key: string;
  p: string;
  t: string;
  tAr: string;
  type: string;
  src: string;
  st: string;
  who: string[];
  msgs: number;
  last: string;
  cost: number;
  kind: string;
};

export const SESSIONS: SessionSeed[] = [
  { key: 'SES-1042', p: 'FIN', t: 'Q4 travel policy update', tAr: 'تحديث سياسة السفر للربع الرابع', type: 'Review', src: 'Console', st: 'Active', who: ['u1', 'u3', 'exp'], msgs: 86, last: '2m', cost: 3.84, kind: 'chat' },
  { key: 'SES-1041', p: 'PRC', t: 'Laptop refresh procurement', tAr: 'مشتريات تحديث أجهزة الحاسوب', type: 'Chat', src: 'Teams', st: 'Active', who: ['u2', 'prc'], msgs: 34, last: '14m', cost: 1.92, kind: 'chat' },
  { key: 'SES-1039', p: 'IT', t: 'Payment gateway incident', tAr: 'حادثة بوابة الدفع', type: 'War-room', src: 'Slack', st: 'Idle', who: ['u2', 'u4', 'bug', 'sup'], msgs: 212, last: '3h', cost: 7.15, kind: 'chat' },
  { key: 'SES-1037', p: 'CS', t: 'Card replacement — A. Karim', tAr: 'استبدال بطاقة — أ. كريم', type: 'Support', src: 'Widget', st: 'Active', who: ['sup'], msgs: 18, last: '1m', cost: 0.11, kind: 'auto' },
  { key: 'SES-1033', p: 'FIN', t: 'Nightly bank reconciliation', tAr: 'التسوية البنكية الليلية', type: 'Automation', src: 'Routine', st: 'Closed', who: ['rec'], msgs: 9, last: '7h', cost: 0.64, kind: 'auto' },
  { key: 'SES-1030', p: 'KB', t: 'Onboarding knowledge refresh', tAr: 'تحديث معرفة التهيئة', type: 'Chat', src: 'Console', st: 'Paused', who: ['u5', 'kb'], msgs: 41, last: '2d', cost: 0.88, kind: 'chat' },
  { key: 'SES-1024', p: 'IT', t: 'Architecture board — AG-UI rollout', tAr: 'مجلس البنية — إطلاق AG-UI', type: 'Review', src: 'Console', st: 'Archived', who: ['u4', 'u2', 'bug'], msgs: 128, last: '9d', cost: 5.02, kind: 'chat' },
];

