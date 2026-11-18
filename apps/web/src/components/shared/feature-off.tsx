"use client";

import { PageHead } from "@/components/shared/page-head";
import { Card } from "@/components/ui/card";
import { useAwp } from "@/hooks/use-awp";

/**
 * What a screen shows when its feature flag is off (S-75).
 *
 * The screen stays reachable and says why it is empty, because a page that simply showed
 * nothing would read as a platform that had lost its data.
 */
export function FeatureOff({ feature, featureAr }: { feature: string; featureAr: string }) {
  const { t } = useAwp();
  return (
    <div className="awp-page">
      <PageHead title={t(feature, featureAr)} sub={t("This feature is turned off.", "هذه الميزة مُعطَّلة.")} />
      <Card>
        <p className="awp-muted" style={{ margin: 0 }} role="note">
          {t(
            `${feature} is turned off in Settings. An administrator can turn it on under feature flags.`,
            `${featureAr} مُعطَّل في الإعدادات. يمكن للمسؤول تفعيله من مفاتيح الميزات.`,
          )}
        </p>
      </Card>
    </div>
  );
}
