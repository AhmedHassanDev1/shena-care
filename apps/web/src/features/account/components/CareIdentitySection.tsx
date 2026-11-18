'use client';

import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import type { CustomerCareProfile } from '../lib/care-profile-api';
import { useMessages } from '@/lib/i18n/LocaleProvider';

interface CareIdentitySectionProps {
  careProfile: CustomerCareProfile | null;
  isLoading?: boolean;
  onEdit: () => void;
}

const SKIN_TYPE_DETAILS: Record<string, { label: string; desc: string }> = {
  normal: { label: 'بشرة عادية', desc: 'إفراز دهون متوازن ورطوبة جيدة بدون تحسس ملحوظ.' },
  dry: { label: 'بشرة جافة', desc: 'مشدودة أحياناً وتحتاج ترطيب عميق وحماية لحاجز البشرة.' },
  oily: { label: 'بشرة دهنية', desc: 'إفراز دهون زائد في منطقة T-Zone أو كامل الوجه، مسام واضحة.' },
  combination: { label: 'بشرة مختلطة', desc: 'دهنية في الجبهة والأنف والذقن، وعادية أو جافة في الوجنتين.' },
  sensitive: { label: 'بشرة حساسة', desc: 'سريعة الاحمرار والتهيج وتفضل تركيبات مهدئة خالية من العطور.' },
};

const HAIR_TYPE_DETAILS: Record<string, { label: string; desc: string }> = {
  straight: { label: 'شعر ناعم / مفرود', desc: 'ينسدل بانسيابية ويحتاج ترطيب خفيف دون إثقال.' },
  wavy: { label: 'شعر مموج', desc: 'تموجات ناعمة تحتاج تحكم في الهيشان وتغذية متوازنة.' },
  curly: { label: 'شعر كيرلي', desc: 'حلقات لولبية واضحة تحتاج ترطيب عالي وحفظ للرطوبة.' },
  coily: { label: 'شعر أفريقي / كويلي', desc: 'التفافات ضيقة تتطلب عناية مكثفة بالزيوت والزبدات المرطبة.' },
};

const SCALP_TYPE_DETAILS: Record<string, { label: string }> = {
  normal: { label: 'فروة عادية متوازنة' },
  dry: { label: 'فروة جافة تحتاج ترطيب' },
  oily: { label: 'فروة دهنية تحتاج تنظيف عميق' },
  sensitive: { label: 'فروة حساسة تحتاج تهدئة' },
};

const TEXTURE_DETAILS: Record<string, string> = {
  gel: 'جل خفيف سريع الامتصاص',
  cream: 'كريم متوازن',
  lotion: 'لوشن حليبي خفيف',
  fluid: 'سائل مائي خفيف',
  rich_cream: 'كريم غني ومغذي',
};

export function CareIdentitySection({
  careProfile,
  isLoading,
  onEdit,
}: CareIdentitySectionProps) {
  const m = useMessages();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="h-64 animate-pulse rounded-card bg-sand/40" />
        <div className="h-64 animate-pulse rounded-card bg-sand/40" />
      </div>
    );
  }

  const skin = careProfile?.skinType ? SKIN_TYPE_DETAILS[careProfile.skinType] : null;
  const hair = careProfile?.hairType ? HAIR_TYPE_DETAILS[careProfile.hairType] : null;
  const scalp = careProfile?.scalpType ? SCALP_TYPE_DETAILS[careProfile.scalpType] : null;
  const texture = careProfile?.preferredTexture ? TEXTURE_DETAILS[careProfile.preferredTexture] : null;

  const skinConcerns = careProfile?.concerns?.filter((c) => c.concern.careArea === 'skin') || [];
  const hairConcerns = careProfile?.concerns?.filter((c) => c.concern.careArea === 'hair') || [];
  const otherConcerns = careProfile?.concerns?.filter((c) => c.concern.careArea !== 'skin' && c.concern.careArea !== 'hair') || [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="m-0 font-display text-20 md:text-24 font-extrabold text-ink">
            {m.profileCareHubTitle}
          </h2>
          <p className="m-0 mt-1 text-14 text-stone">
            {m.profileCareHubSubtitle}
          </p>
        </div>
        <Button
          type="button"
          variant="light"
          size="s"
          onClick={onEdit}
          className="rounded-pill border border-line/80 bg-chalk/90 text-ink shadow-elevation-1 hover:bg-sand/40"
        >
          <Icon name="pencil" size={14} />
          <span>{m.profileEditCareProfile}</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Skin Profile Card */}
        <div className="flex flex-col justify-between rounded-card border border-line bg-linen/95 p-6 shadow-elevation-1">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-line/60 pb-3">
              <span className="flex items-center gap-2 font-display text-17 font-bold text-ink">
                <Icon name="sparkles" size={18} className="text-cobalt" />
                <span>{m.profileCareSkinTitle}</span>
              </span>
              {skin ? (
                <span className="rounded-pill bg-cobalt-deep/10 px-3 py-1 text-12 font-semibold text-cobalt">
                  {skin.label}
                </span>
              ) : null}
            </div>

            {skin ? (
              <p className="m-0 text-14 leading-relaxed text-stone">
                {skin.desc}
              </p>
            ) : (
              <p className="m-0 text-14 text-stone/80">
                لم يتم تحديد نوع البشرة بعد.
              </p>
            )}

            {texture ? (
              <div className="flex items-center gap-2 text-13 text-stone">
                <span className="text-stone">{m.profilePreferredTextureLabel}:</span>
                <span className="font-semibold text-ink">{texture}</span>
              </div>
            ) : null}

            {skinConcerns.length > 0 ? (
              <div className="mt-2 flex flex-col gap-2">
                <span className="text-12 font-medium text-stone">{m.profileConcernsLabel}:</span>
                <div className="flex flex-wrap gap-1.5">
                  {skinConcerns.map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1 rounded-pill border border-line/70 bg-chalk/90 px-2.5 py-1 text-12 font-medium text-ink shadow-outline-hairline"
                    >
                      <Icon name="target" size={12} className="text-cobalt" />
                      <span>{c.concern.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Hair & Scalp Profile Card */}
        <div className="flex flex-col justify-between rounded-card border border-line bg-linen/95 p-6 shadow-elevation-1">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-line/60 pb-3">
              <span className="flex items-center gap-2 font-display text-17 font-bold text-ink">
                <Icon name="frizz" size={18} className="text-cobalt" />
                <span>{m.profileCareHairTitle}</span>
              </span>
              {hair ? (
                <span className="rounded-pill bg-cobalt-deep/10 px-3 py-1 text-12 font-semibold text-cobalt">
                  {hair.label}
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 text-14 leading-relaxed text-stone">
              {hair ? (
                <p className="m-0 text-14 text-stone">{hair.desc}</p>
              ) : (
                <p className="m-0 text-14 text-stone/80">لم يتم تحديد نوع الشعر بعد.</p>
              )}

              {scalp ? (
                <div className="mt-1 flex items-center gap-2 text-13 text-stone">
                  <span className="text-stone">{m.profileScalpTypeLabel}:</span>
                  <span className="font-semibold text-ink">{scalp.label}</span>
                </div>
              ) : null}
            </div>

            {hairConcerns.length > 0 ? (
              <div className="mt-2 flex flex-col gap-2">
                <span className="text-12 font-medium text-stone">{m.profileConcernsLabel}:</span>
                <div className="flex flex-wrap gap-1.5">
                  {hairConcerns.map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1 rounded-pill border border-line/70 bg-chalk/90 px-2.5 py-1 text-12 font-medium text-ink shadow-outline-hairline"
                    >
                      <Icon name="target" size={12} className="text-cobalt" />
                      <span>{c.concern.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Allergies, Sensitivities & Fragrance Preferences */}
      <div className="flex flex-col gap-3 rounded-card border border-line/80 bg-linen/90 p-5 shadow-outline-hairline md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-14 font-semibold text-ink">
            <Icon name="shield" size={16} className="text-cobalt" />
            <span>{m.profileSensitivitiesLabel}:</span>
          </span>
          <span className="text-14 text-stone">
            {careProfile?.sensitivities?.trim() || m.profileSensitivitiesNone}
          </span>
        </div>

        <div className="flex items-center gap-2 border-t border-line/60 pt-2 md:border-0 md:pt-0">
          <span className="text-12 text-stone">{m.profileFragranceLabel}:</span>
          <span className="rounded-pill border border-line/70 bg-chalk/90 px-3 py-1 text-12 font-semibold text-ink shadow-outline-hairline">
            {careProfile?.fragranceFree ? m.profileFragranceFree : m.profileFragranceStandard}
          </span>
        </div>
      </div>

      {/* Other general concerns if any */}
      {otherConcerns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-12 text-stone">{m.profileConcernsLabel}:</span>
          {otherConcerns.map((c) => (
            <span
              key={c.id}
              className="rounded-pill border border-line/70 bg-chalk/90 px-2.5 py-1 text-12 text-ink shadow-outline-hairline"
            >
              {c.concern.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
