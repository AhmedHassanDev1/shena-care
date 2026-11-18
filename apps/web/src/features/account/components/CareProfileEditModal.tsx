'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  careProfileApi,
  type CustomerCareProfile,
  type SkinType,
  type HairType,
  type ScalpType,
  type CareFocus,
  type SunExposure,
  type PreferredTexture,
  type ConcernItem,
} from '../lib/care-profile-api';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { cn } from '@/lib/utils';

interface CareProfileEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialProfile: CustomerCareProfile | null;
  onSaved: () => void;
}

const SKIN_OPTIONS: Array<{ value: SkinType; label: string }> = [
  { value: 'normal', label: 'عادية' },
  { value: 'dry', label: 'جافة' },
  { value: 'oily', label: 'دهنية' },
  { value: 'combination', label: 'مختلطة' },
  { value: 'sensitive', label: 'حساسة' },
];

const HAIR_OPTIONS: Array<{ value: HairType; label: string }> = [
  { value: 'straight', label: 'ناعم / مفرود' },
  { value: 'wavy', label: 'مموج' },
  { value: 'curly', label: 'كيرلي' },
  { value: 'coily', label: 'أفريقي / كويلي' },
];

const SCALP_OPTIONS: Array<{ value: ScalpType; label: string }> = [
  { value: 'normal', label: 'عادية' },
  { value: 'dry', label: 'جافة' },
  { value: 'oily', label: 'دهنية' },
  { value: 'sensitive', label: 'حساسة' },
];

const FOCUS_OPTIONS: Array<{ value: CareFocus; label: string }> = [
  { value: 'skin', label: 'البشرة أولاً' },
  { value: 'hair', label: 'الشعر أولاً' },
  { value: 'both', label: 'البشرة والشعر معاً' },
];

const SUN_OPTIONS: Array<{ value: SunExposure; label: string }> = [
  { value: 'low', label: 'قليل (داخل المباني)' },
  { value: 'moderate', label: 'معتدل' },
  { value: 'high', label: 'مكثف / شمس مباشرة' },
];

const TEXTURE_OPTIONS: Array<{ value: PreferredTexture; label: string }> = [
  { value: 'gel', label: 'جل خفيف' },
  { value: 'cream', label: 'كريم متوازن' },
  { value: 'lotion', label: 'لوشن' },
  { value: 'fluid', label: 'سائل مائي' },
  { value: 'rich_cream', label: 'كريم غني' },
];

export function CareProfileEditModal({
  isOpen,
  onClose,
  initialProfile,
  onSaved,
}: CareProfileEditModalProps) {
  const m = useMessages();

  const [skinType, setSkinType] = useState<SkinType | null>(initialProfile?.skinType ?? null);
  const [hairType, setHairType] = useState<HairType | null>(initialProfile?.hairType ?? null);
  const [scalpType, setScalpType] = useState<ScalpType | null>(initialProfile?.scalpType ?? null);
  const [primaryFocus, setPrimaryFocus] = useState<CareFocus | null>(initialProfile?.primaryFocus ?? 'both');
  const [sunExposure, setSunExposure] = useState<SunExposure | null>(initialProfile?.sunExposure ?? null);
  const [preferredTexture, setPreferredTexture] = useState<PreferredTexture | null>(initialProfile?.preferredTexture ?? null);
  const [fragranceFree, setFragranceFree] = useState<boolean>(initialProfile?.fragranceFree ?? false);
  const [sensitivities, setSensitivities] = useState<string>(initialProfile?.sensitivities ?? '');
  const [selectedConcernIds, setSelectedConcernIds] = useState<string[]>(
    initialProfile?.concerns?.map((c) => c.concernId) || []
  );

  const [availableConcerns, setAvailableConcerns] = useState<ConcernItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialProfile) {
      setSkinType(initialProfile.skinType);
      setHairType(initialProfile.hairType);
      setScalpType(initialProfile.scalpType);
      setPrimaryFocus(initialProfile.primaryFocus ?? 'both');
      setSunExposure(initialProfile.sunExposure);
      setPreferredTexture(initialProfile.preferredTexture);
      setFragranceFree(Boolean(initialProfile.fragranceFree));
      setSensitivities(initialProfile.sensitivities ?? '');
      setSelectedConcernIds(initialProfile.concerns?.map((c) => c.concernId) || []);
    }
  }, [initialProfile]);

  useEffect(() => {
    if (isOpen) {
      careProfileApi.getPublicConcerns().then(setAvailableConcerns).catch(() => {});
    }
  }, [isOpen]);

  const toggleConcern = (concernId: string) => {
    setSelectedConcernIds((prev) =>
      prev.includes(concernId) ? prev.filter((id) => id !== concernId) : [...prev, concernId]
    );
  };

  const handleSave = async () => {
    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      await careProfileApi.updateProfile({
        skinType,
        hairType,
        scalpType,
        primaryFocus,
        sunExposure,
        preferredTexture,
        fragranceFree,
        sensitivities: sensitivities.trim() || null,
        concerns: selectedConcernIds.map((concernId) => ({ concernId, severity: 1 })),
      });

      onSaved();
      onClose();
    } catch {
      setErrorMessage(m.profileCareProfileSaveFailed);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-[620px] overflow-y-auto rounded-card border border-line bg-linen p-6 shadow-elevation-3 md:p-8" closeLabel={m.profileAddressCancel}>
        <DialogHeader className="border-b border-line pb-4">
          <DialogTitle className="text-display-3 font-bold text-ink">
            {m.profileEditCareProfile}
          </DialogTitle>
          <DialogDescription className="text-14 text-stone">
            {m.profileCareHubSubtitle}
          </DialogDescription>
        </DialogHeader>

        {errorMessage ? (
          <div className="rounded-card border border-tomato/30 bg-tomato/10 p-3 text-13 font-medium text-tomato-ink">
            {errorMessage}
          </div>
        ) : null}

        <div className="flex flex-col gap-6 py-2">
          {/* Skin Type */}
          <div className="flex flex-col gap-2.5">
            <span className="font-display text-14 font-semibold text-ink">
              {m.profileSkinTypeLabel}
            </span>
            <div className="flex flex-wrap gap-2">
              {SKIN_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSkinType(skinType === opt.value ? null : opt.value)}
                  className={cn(
                    'rounded-pill border px-3.5 py-1.5 text-13 font-medium transition-colors',
                    skinType === opt.value
                      ? 'border-cobalt bg-cobalt text-chalk shadow-elevation-1'
                      : 'border-line/70 bg-chalk/90 text-ink shadow-outline-hairline hover:border-line hover:bg-sand/30'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hair Type */}
          <div className="flex flex-col gap-2.5">
            <span className="font-display text-14 font-semibold text-ink">
              {m.profileHairTypeLabel}
            </span>
            <div className="flex flex-wrap gap-2">
              {HAIR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setHairType(hairType === opt.value ? null : opt.value)}
                  className={cn(
                    'rounded-pill border px-3.5 py-1.5 text-13 font-medium transition-colors',
                    hairType === opt.value
                      ? 'border-cobalt bg-cobalt text-chalk shadow-elevation-1'
                      : 'border-line/70 bg-chalk/90 text-ink shadow-outline-hairline hover:border-line hover:bg-sand/30'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scalp Type */}
          <div className="flex flex-col gap-2.5">
            <span className="font-display text-14 font-semibold text-ink">
              {m.profileScalpTypeLabel}
            </span>
            <div className="flex flex-wrap gap-2">
              {SCALP_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setScalpType(scalpType === opt.value ? null : opt.value)}
                  className={cn(
                    'rounded-pill border px-3.5 py-1.5 text-13 font-medium transition-colors',
                    scalpType === opt.value
                      ? 'border-cobalt bg-cobalt text-chalk shadow-elevation-1'
                      : 'border-line/70 bg-chalk/90 text-ink shadow-outline-hairline hover:border-line hover:bg-sand/30'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Primary Focus */}
          <div className="flex flex-col gap-2.5">
            <span className="font-display text-14 font-semibold text-ink">
              {m.profileCareFocusLabel}
            </span>
            <div className="flex flex-wrap gap-2">
              {FOCUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPrimaryFocus(opt.value)}
                  className={cn(
                    'rounded-pill border px-3.5 py-1.5 text-13 font-medium transition-colors',
                    primaryFocus === opt.value
                      ? 'border-cobalt bg-cobalt text-chalk shadow-elevation-1'
                      : 'border-line/70 bg-chalk/90 text-ink shadow-outline-hairline hover:border-line hover:bg-sand/30'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sun Exposure */}
          <div className="flex flex-col gap-2.5">
            <span className="font-display text-14 font-semibold text-ink">
              {m.profileSunExposureLabel}
            </span>
            <div className="flex flex-wrap gap-2">
              {SUN_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSunExposure(sunExposure === opt.value ? null : opt.value)}
                  className={cn(
                    'rounded-pill border px-3.5 py-1.5 text-13 font-medium transition-colors',
                    sunExposure === opt.value
                      ? 'border-cobalt bg-cobalt text-chalk shadow-elevation-1'
                      : 'border-line/70 bg-chalk/90 text-ink shadow-outline-hairline hover:border-line hover:bg-sand/30'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preferred Texture */}
          <div className="flex flex-col gap-2.5">
            <span className="font-display text-14 font-semibold text-ink">
              {m.profilePreferredTextureLabel}
            </span>
            <div className="flex flex-wrap gap-2">
              {TEXTURE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPreferredTexture(preferredTexture === opt.value ? null : opt.value)}
                  className={cn(
                    'rounded-pill border px-3.5 py-1.5 text-13 font-medium transition-colors',
                    preferredTexture === opt.value
                      ? 'border-cobalt bg-cobalt text-chalk shadow-elevation-1'
                      : 'border-line/70 bg-chalk/90 text-ink shadow-outline-hairline hover:border-line hover:bg-sand/30'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Fragrance Preference */}
          <div className="flex items-center justify-between rounded-card border border-line/70 bg-sand/20 p-4">
            <div className="flex flex-col gap-1">
              <span className="font-display text-14 font-semibold text-ink">
                {m.profileFragranceLabel}
              </span>
              <span className="text-12 text-stone">
                تفضيل تركيبات خالية تماماً من العطور الصناعية لحماية البشرة الحساسة.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={fragranceFree}
              onClick={() => setFragranceFree((prev) => !prev)}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-pill border-2 border-transparent transition-colors duration-fast',
                fragranceFree ? 'bg-cobalt' : 'bg-sand'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block size-6 rounded-pill bg-linen shadow-elevation-1 ring-0 transition duration-fast',
                  fragranceFree ? 'translate-x-[-20px]' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          {/* Sensitivities */}
          <div className="flex flex-col gap-2">
            <label htmlFor="sensitivities-input" className="font-display text-14 font-semibold text-ink">
              {m.profileSensitivitiesLabel}
            </label>
            <input
              id="sensitivities-input"
              type="text"
              value={sensitivities}
              onChange={(e) => setSensitivities(e.target.value)}
              placeholder="مثال: حساسية من زيت شجرة الشاي، حمض الساليسيليك…"
              className="h-control-m rounded-input border border-line/80 bg-chalk/90 px-4 font-display text-14 text-ink shadow-outline-hairline outline-none focus:border-cobalt"
            />
          </div>

          {/* Concerns Multiselect */}
          {availableConcerns.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              <span className="font-display text-14 font-semibold text-ink">
                {m.profileConcernsLabel}
              </span>
              <div className="flex flex-wrap gap-2">
                {availableConcerns.map((c) => {
                  const isSelected = selectedConcernIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleConcern(c.id)}
                      className={cn(
                        'rounded-pill border px-3 py-1.5 text-12 font-medium transition-colors',
                        isSelected
                          ? 'border-cobalt bg-cobalt text-chalk shadow-elevation-1'
                          : 'border-line/70 bg-chalk/90 text-ink shadow-outline-hairline hover:border-line hover:bg-sand/30'
                      )}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-4">
          <Button type="button" variant="light" size="m" onClick={onClose} disabled={isSubmitting}>
            {m.profileAddressCancel}
          </Button>
          <Button type="button" variant="cobalt" size="m" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Icon name="clock" size={16} className="animate-spin" />
                <span>{m.profileAddressSaving}</span>
              </span>
            ) : (
              <span>{m.profileSaveCareProfile}</span>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
