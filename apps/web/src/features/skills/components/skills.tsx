"use client";

import { useEffect, useState } from "react";

import { type Skill, type SkillDetail } from "@/features/skills/types";
import { bAr, bTone } from "@/i18n/vocabulary";
import { useModals } from "@/components/shared/modal-host";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Ic } from "@/components/ui/icon";
import { Tabs } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { deleteSkill, loadSkillFiles, publishSkill } from "@/features/skills/actions";
import { fileKind } from "@/features/skills/file-kinds";
import { Refused } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { Grid } from "@/components/shared/layout";
import { humanSize } from "@/lib/utils";

/**
 * S-53: the Skills screen. The Installed tab lists every skill not awaiting a scan, My Skills
 * the authored ones; Import and New open their dialogs. A selected skill opens its detail: its
 * package's files, each shown on selection, scan results, the agents using it, Download as
 * .zip, Publish, and Delete for a skill that is not bundled. Each action reports the server's
 * refusal as a toast.
 */
export function Skills({ skills, details }: { skills: Skill[]; details: Record<string, SkillDetail> }) {
  const { t, why } = useAwp();
  const { open } = useModals();
  const [tab, setTab] = useState('installed');
  // By name, so an update shows the skill's new version as the page reads it again.
  const [selName, setSelName] = useState<string | null>(null);
  const sel = skills.find((skill) => skill.n === selName) ?? null;
  const setSel = (skill: Skill | null) => setSelName(skill?.n ?? null);
  const [picked, setPicked] = useState<string | null>(null);
  const [run, busy] = useAction();
  const pkg = usePackage(sel ? `${sel.n}@${sel.v}` : null, sel?.n ?? null);
  if (sel) {
    const d = details[sel.n];
    const scan: [string, number][] = d?.scan
      ? [
          [t('Scripts', 'السكربتات'), d.scan.scripts],
          [t('Network calls', 'اتصالات الشبكة'), d.scan.networkCalls],
          [t('Prompt-injection patterns', 'أنماط حقن الأوامر'), d.scan.promptInjectionPatterns],
          [t('Embedded secrets', 'أسرار مضمنة'), d.scan.embeddedSecrets],
        ]
      : [];
    const shown = pkg?.files?.find((f) => f.path === picked) ?? pkg?.files?.[0];
    const noZip = !pkg ? t('Reading the package…', 'جارٍ قراءة الحزمة…') : pkg.refusal !== undefined ? why(pkg.refusal) : !pkg.files?.length ? t('No files are stored for this skill.', 'لا توجد ملفات مخزنة لهذه المهارة.') : undefined;
    return (
      <div className="awp-page">
        <PageHead
          crumb={<Lnk onClick={() => setSel(null)}>{t('AI Capabilities / Skills', 'قدرات الذكاء الاصطناعي / المهارات')}</Lnk>}
          title={<span className="awp-mono" style={{ fontFamily: 'inherit' }}>{sel.n}</span>}
          sub={sel.src + ' · ' + sel.v}
        >
          <Tg tone={bTone[sel.b]} label={t(sel.b, bAr[sel.b])} />
          {/* D228: a bundled skill ships with the platform and is not deleted; the server refuses it. */}
          {sel.src !== 'Bundled' && (
          <Btn
            type="danger"
            label={t('Delete skill', 'حذف المهارة')}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await deleteSkill({ skillName: sel.n });
                if (!result.ok) throw new Refused({ reason: why(result) });
                setSel(null);
                return t(`${sel.n} was deleted.`, `حُذفت ${sel.n}.`);
              })
            }
          />
          )}
          {/* D228: a bundled skill's files ship in the agent image, so they are not replaced here. */}
          {sel.src !== 'Bundled' && (
            <Btn type="secondary" icon="Upload04" label={t('Update from .zip', 'تحديث من .zip')} onClick={() => open('importSkill', { name: sel.n })} />
          )}
          <Btn
            type="secondary"
            icon="Download04"
            label={t('Download as .zip', 'تنزيل بصيغة .zip')}
            disabled={noZip !== undefined}
            title={noZip}
            onClick={() => window.open(`/api/skills/${encodeURIComponent(sel.n)}/package`, '_blank', 'noopener')}
          />
          <Btn
            label={t('Publish', 'نشر')}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await publishSkill({ skillName: sel.n });
                if (!result.ok) throw new Refused({ reason: why(result) });
                // `UC-53.3-03`: who is pinned to which version, which is Where used.
                return result.usedBy.length
                  ? t(
                      `Published. Used by ${result.usedBy.map((u) => `${u.agent} (${u.version})`).join(', ')}.`,
                      `تم النشر. مستخدمة في ${result.usedBy.map((u) => `${u.agent} (${u.version})`).join('، ')}.`,
                    )
                  : t('Published. No agent uses it yet.', 'تم النشر. لا يستخدمها وكيل بعد.');
              })
            }
          />
        </PageHead>
        <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr) 280px', gap: 16 }} className="awp-two">
          <Card title={t('Files', 'الملفات')} pad={false}>
            {pkg?.files?.map((f) => (
              <button
                key={f.path}
                className="awp-row awp-mono"
                aria-current={f.path === shown?.path ? 'true' : undefined}
                onClick={() => setPicked(f.path)}
                style={{ width: '100%', padding: '10px 16px', textAlign: 'start', cursor: 'pointer', border: 0, borderBottom: '1px solid var(--border-divider)', background: f.path === shown?.path ? 'var(--surface-brand-subtle)' : 'transparent', color: 'inherit' }}
              >
                <Ic n="File01" s={16} />
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.path}</span>
              </button>
            ))}
            {noZip !== undefined && <p className="awp-muted awp-small" style={{ margin: 0, padding: '10px 16px' }}>{noZip}</p>}
          </Card>
          <Card title={shown ? <span className="awp-mono">{shown.path}</span> : t('File', 'الملف')}>
            {shown ? <PackageFile key={shown.path} skill={sel.n} file={shown} /> : <p className="awp-muted awp-small" style={{ margin: 0 }}>{t('No file to show.', 'لا يوجد ملف للعرض.')}</p>}
          </Card>
          <div className="awp-col" style={{ gap: 16 }}>
            <Card title={t('Security scan', 'الفحص الأمني')}>
              {scan.length ? (
                scan.map(([k, found]) => (
                  <div key={k} className="awp-row" style={{ padding: '4px 0' }}>
                    <Ic n={found === 0 ? 'TickCircle' : 'InfoSign'} c={found === 0 ? 'var(--icon-success)' : 'var(--icon-warning)'} s={18} />
                    <span style={{ flex: 1 }}>{k}</span>
                    <span className="awp-small awp-muted">{found}</span>
                  </div>
                ))
              ) : (
                <p className="awp-muted awp-small" style={{ margin: 0 }}>{t('Not scanned yet.', 'لم يُفحص بعد.')}</p>
              )}
            </Card>
            <Card title={t('Where used', 'أماكن الاستخدام')}>
              {(d?.usedBy ?? []).map((w) => (
                <div key={w} style={{ padding: '4px 0' }}>{w}</div>
              ))}
              {!(d?.usedBy ?? []).length && <p className="awp-muted awp-small" style={{ margin: 0 }}>{t('Not used by any agent yet.', 'لا يستخدمها أي وكيل بعد.')}</p>}
            </Card>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="awp-page">
      <PageHead crumb={t('AI Capabilities', 'قدرات الذكاء الاصطناعي')} title={t('Skills', 'المهارات')} sub={t('Reusable capabilities in the Agent Skills standard format.', 'قدرات قابلة لإعادة الاستخدام بصيغة Agent Skills القياسية.')}>
        <Btn type="secondary" label={t('Import skill package', 'استيراد حزمة مهارة')} icon="Download04" onClick={() => open('importSkill')} />
        <Btn label={t('New skill', 'مهارة جديدة')} icon="AddCircle" onClick={() => open('skill')} />
      </PageHead>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'installed', label: t('Installed', 'المثبتة'), count: skills.filter((s) => s.b !== 'Pending scan').length }, { id: 'mine', label: t('My Skills', 'مهاراتي'), count: skills.filter((s) => s.src === 'Authored').length }]} />
      <Grid min={300}>
        {skills.filter((s) => (tab === 'mine' ? s.src === 'Authored' : s.b !== 'Pending scan')).map((s) => (
          <button key={s.n} className="awp-card" onClick={() => { setSel(s); setPicked(null); }} style={{ padding: 18, textAlign: 'start', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="awp-row">
              <Ic n="Notebook" c="var(--icon-brand)" />
              <b className="awp-mono" style={{ flex: 1, fontSize: 14 }}>{s.n}</b>
              <Tg tone={bTone[s.b]} label={t(s.b, bAr[s.b])} />
            </div>
            <div className="awp-small awp-muted" style={{ lineHeight: 1.5 }}>{t(s.d, s.dAr)}</div>
            <div className="awp-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {s.tags.map((tag) => (
                <Tg key={tag} label={tag} />
              ))}
            </div>
            <div className="awp-row awp-small awp-muted" style={{ borderTop: '1px solid var(--border-divider)', paddingTop: 10, justifyContent: 'space-between' }}>
              <span>{s.src} · {s.v}</span>
              <span>{t(`Enabled for ${s.agents} agents`, `مفعّلة لـ ${s.agents} وكلاء`)}</span>
            </div>
          </button>
        ))}
      </Grid>
    </div>
  );
}

type StoredFile = { path: string; size: number };

/**
 * The skill's package files, read when its detail opens and again when `key` (its name and
 * version) changes; null while they are read.
 */
function usePackage(key: string | null, skillName: string | null): { files?: StoredFile[]; refusal?: unknown } | null {
  const [state, setState] = useState<{ key: string; files?: StoredFile[]; refusal?: unknown } | null>(null);
  useEffect(() => {
    if (!key || !skillName) return;
    let current = true;
    void loadSkillFiles({ skillName }).then(
      (outcome) => {
        if (current) setState(outcome.ok ? { key, files: outcome.value } : { key, refusal: outcome });
      },
      (problem: unknown) => {
        if (current) setState({ key, refusal: problem });
      },
    );
    return () => {
      current = false;
    };
  }, [key, skillName]);
  return state?.key === key ? state : null;
}

/** One package file: text as text, a raster image as an image, anything else by its size with Download. */
function PackageFile({ skill, file }: { skill: string; file: StoredFile }) {
  const { t } = useAwp();
  const url = `/api/skills/${encodeURIComponent(skill)}/files?path=${encodeURIComponent(file.path)}`;
  const kind = fileKind(file.path);
  const [text, setText] = useState<{ body: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (kind !== 'text') return;
    let current = true;
    fetch(url).then(
      async (response) => {
        const body = await response.text();
        if (current) setText({ body, ok: response.ok });
      },
      () => {
        if (current) setText({ body: '', ok: false });
      },
    );
    return () => {
      current = false;
    };
  }, [url, kind]);
  if (kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element -- the console serves the bytes; there is nothing for next/image to optimise.
    return <img src={url} alt={file.path} style={{ maxWidth: '100%', height: 'auto' }} />;
  }
  if (kind === 'text') {
    if (!text) return <p className="awp-muted awp-small" style={{ margin: 0 }}>{t('Reading the file…', 'جارٍ قراءة الملف…')}</p>;
    if (!text.ok) return <p className="awp-small" role="alert" style={{ margin: 0 }}>{text.body || t('The file could not be read.', 'تعذّرت قراءة الملف.')}</p>;
    return <pre className="awp-mono" style={{ margin: 0, whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left', lineHeight: 1.7 }}>{text.body}</pre>;
  }
  return (
    <div className="awp-row" style={{ gap: 12 }}>
      <span className="awp-small awp-muted" style={{ flex: 1 }}>{t(`This file cannot be shown here · ${humanSize(file.size)}`, `لا يمكن عرض هذا الملف هنا · ${humanSize(file.size)}`)}</span>
      <Btn type="secondary" label={t('Download', 'تنزيل')} onClick={() => window.open(`${url}&download=1`, '_blank', 'noopener')} />
    </div>
  );
}
