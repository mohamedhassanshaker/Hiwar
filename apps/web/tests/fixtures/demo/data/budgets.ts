/** The prototype's agent budgets and the six-month history behind them. */
type BudgetSeed = { a: string; lim: number; per: string; from: string; to: string | null; soft: number; hard: string; spent: number };

export const BUDGETS0: BudgetSeed[] = [
  { a: 'sup', lim: 450, per: 'Monthly', from: '2026-01-01', to: null, soft: 80, hard: 'Switch to cheaper alias', spent: 412.9 },
  { a: 'exp', lim: 250, per: 'Monthly', from: '2026-07-01', to: null, soft: 75, hard: 'Pause agent', spent: 186.4 },
  { a: 'bug', lim: 150, per: 'Monthly', from: '2026-09-01', to: '2026-12-31', soft: 80, hard: 'Pause agent', spent: 141 },
  { a: 'rec', lim: 120, per: 'Monthly', from: '2026-03-01', to: null, soft: 80, hard: 'Notify only', spent: 63.1 },
  { a: 'prc', lim: 200, per: 'Monthly', from: '2026-10-01', to: '2027-03-31', soft: 80, hard: 'Pause agent', spent: 58.7 },
  { a: 'kb', lim: 40, per: 'Monthly', from: '2026-05-01', to: '2026-09-30', soft: 80, hard: 'Pause agent', spent: 12.4 },
];

export const MONTHS: [string, string][] = [['May', 'مايو'], ['Jun', 'يونيو'], ['Jul', 'يوليو'], ['Aug', 'أغسطس'], ['Sep', 'سبتمبر'], ['Oct', 'أكتوبر']];

export const histOf = (b: BudgetSeed) =>
  MONTHS.map((m, i) => {
    const f = [0.62, 0.71, 0.84, 0.9, 1.02, 0][i];
    return { m, lim: b.lim, v: i === 5 ? b.spent : Math.round(b.lim * f * (0.85 + ((b.a.charCodeAt(0) + i) % 5) * 0.05)) };
  });

export const budStatus = (b: BudgetSeed) => {
  const today = '2026-10-09';
  if (b.from > today) return 'Planned';
  if (b.to && b.to < today) return 'Expired';
  return 'Active';
};

export const pctCol = (p: number) => (p > 90 ? 'var(--icon-danger)' : p > 75 ? 'var(--icon-warning)' : 'var(--action-primary-bg)');
