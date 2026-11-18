'use client';

import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { GlassBadge } from '@/components/ui/glass-badge';
import type { CustomerCareProfile } from '../lib/care-profile-api';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';

interface CareProfileOverviewProps {
  user: { name?: string | null; phoneNumber?: string | null };
  careProfile: CustomerCareProfile | null;
  isLoading?: boolean;
  onEditCareProfile: () => void;
}

const SKIN_TYPE_NAMES: Record<string, string> = {
  normal: 'عادية',
  dry: 'جافة',
  oily: 'دهنية',
  combination: 'مختلطة',
  sensitive: 'حساسة',
};

const HAIR_TYPE_NAMES: Record<string, string> = {
  straight: 'ناعم / مفرود',
  wavy: 'مموج',
  curly: 'كيرلي',
  coily: 'أفريقي / كويلي',
};

const SCALP_TYPE_NAMES: Record<string, string> = {
  normal: 'عادية',
  dry: 'جافة',
  oily: 'دهنية',
  sensitive: 'حساسة',
};

const CARE_FOCUS_NAMES: Record<string, string> = {
  skin: 'العناية بالبشرة',
  hair: 'العناية بالشعر',
  both: 'البشرة والشعر معاً',
};

const SUN_EXPOSURE_NAMES: Record<string, string> = {
  low: 'تعرض خفيف للشمس',
  moderate: 'تعرض معتدل',
  high: 'تعرض مكثف ومباشر',
};

export function CareProfileOverview({
  user,
  careProfile,
  isLoading,
  onEditCareProfile,
}: CareProfileOverviewProps) {
  const m = useMessages();
  const displayName = user.name?.trim() || null;

  const skinName = careProfile?.skinType ? SKIN_TYPE_NAMES[careProfile.skinType] || careProfile.skinType : null;
  const hairName = careProfile?.hairType ? HAIR_TYPE_NAMES[careProfile.hairType] || careProfile.hairType : null;
  const scalpName = careProfile?.scalpType ? SCALP_TYPE_NAMES[careProfile.scalpType] || careProfile.scalpType : null;
  const focusName = careProfile?.primaryFocus ? CARE_FOCUS_NAMES[careProfile.primaryFocus] || careProfile.primaryFocus : null;
  const sunName = careProfile?.sunExposure ? SUN_EXPOSURE_NAMES[careProfile.sunExposure] || careProfile.sunExposure : null;

  const hasAnyCareData = Boolean(skinName || hairName || scalpName || (careProfile?.concerns && careProfile.concerns.length > 0));

  return (
    <section
      aria-label={m.profileCareHubTitle}
      className="routine-glass relative overflow-hidden rounded-card p-6 md:p-8"
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <GlassBadge tone="quiet">
              <span className="flex items-center gap-1.5 font-display text-13 font-semibold text-cobalt">
                <Icon name="sparkles" size={14} />
                <span>{m.profileCareHubTitle}</span>
              </span>
            </GlassBadge>
            {user.phoneNumber ? (
              <span className="inline-flex items-center gap-1 rounded-pill bg-ok-tint px-2.5 py-1 text-12 font-semibold text-ok">
                <Icon name="check" size={12} strokeWidth={2.5} />
                <span>{m.profileVerifiedMobile}</span>
              </span>
            ) : null}
          </div>

          <h1 className="m-0 font-display text-display-1 font-bold text-ink">
            {displayName
              ? fillMessage(m.profileGreetingNamed, { name: displayName })
              : m.profileGreetingUnnamed}
          </h1>

          <p className="m-0 max-w-xl text-15 leading-relaxed text-stone">
            {m.profileCareHubSubtitle}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <Button
            type="button"
            variant="light"
            size="m"
            onClick={onEditCareProfile}
            className="rounded-pill shadow-outline-control"
          >
            <Icon name="pencil" size={16} />
            <span>{hasAnyCareData ? m.profileEditCareProfile : m.profileCareProfileSetupAction}</span>
          </Button>
        </div>
      </div>

      <div className="mt-6 border-t border-line/60 pt-5">
        {isLoading ? (
          <div className="flex flex-wrap gap-2">
            <div className="h-8 w-28 animate-pulse rounded-pill bg-sand/60" />
            <div className="h-8 w-32 animate-pulse rounded-pill bg-sand/60" />
            <div className="h-8 w-24 animate-pulse rounded-pill bg-sand/60" />
          </div>
        ) : hasAnyCareData ? (
          <div className="flex flex-wrap items-center gap-2.5">
            {skinName ? (
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-linen/90 px-3.5 py-1.5 text-13 font-medium text-ink shadow-elevation-1">
                <span className="text-stone">{m.profileSkinTypeLabel}:</span>
                <strong className="font-semibold text-ink">{skinName}</strong>
              </span>
            ) : null}

            {hairName ? (
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-linen/90 px-3.5 py-1.5 text-13 font-medium text-ink shadow-elevation-1">
                <span className="text-stone">{m.profileHairTypeLabel}:</span>
                <strong className="font-semibold text-ink">{hairName}</strong>
              </span>
            ) : null}

            {scalpName ? (
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-linen/90 px-3.5 py-1.5 text-13 font-medium text-ink shadow-elevation-1">
                <span className="text-stone">{m.profileScalpTypeLabel}:</span>
                <strong className="font-semibold text-ink">{scalpName}</strong>
              </span>
            ) : null}

            {focusName ? (
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-linen/90 px-3.5 py-1.5 text-13 font-medium text-ink shadow-elevation-1">
                <span className="text-stone">{m.profileCareFocusLabel}:</span>
                <strong className="font-semibold text-ink">{focusName}</strong>
              </span>
            ) : null}

            {sunName ? (
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-linen/90 px-3.5 py-1.5 text-13 font-medium text-ink shadow-elevation-1">
                <Icon name="sun" size={13} className="text-citron" />
                <span className="font-medium text-stone">{sunName}</span>
              </span>
            ) : null}

            {careProfile?.fragranceFree ? (
              <span className="inline-flex items-center gap-1 rounded-pill bg-cobalt-deep/10 px-3 py-1 text-12 font-semibold text-cobalt">
                <Icon name="leaf" size={13} />
                <span>{m.profileFragranceFree}</span>
              </span>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-card border border-line/80 bg-linen/60 p-4 md:flex-row md:items-center md:justify-between">
            <p className="m-0 text-14 leading-relaxed text-stone">
              {m.profileCareProfileEmpty}
            </p>
            <Button
              type="button"
              variant="cobalt"
              size="s"
              onClick={onEditCareProfile}
              className="shrink-0 rounded-pill"
            >
              <Icon name="plus" size={14} />
              <span>{m.profileCareProfileSetupAction}</span>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
