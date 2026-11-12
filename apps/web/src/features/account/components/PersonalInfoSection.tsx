'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { useAuth } from '@/features/auth/AuthContext';
import { apiErrorCode, displayMobile } from '@/features/auth/lib/auth-helpers';
import { auth, displayEmail, type User } from '@/lib/auth';
import { useMessages } from '@/lib/i18n/LocaleProvider';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PersonalInfoSectionProps {
  user: User;
  /** Opens editor immediately when true (e.g. triggered from header prompt or /account/profile). */
  editingRequested?: boolean;
  onEditingRequestedHandled?: () => void;
  onSessionExpired?: () => void;
}

/**
 * Editable personal information section backed by PATCH /accounts/me.
 * Uses progressive disclosure: calm read state by default with clean inline editing.
 */
export function PersonalInfoSection({
  user,
  editingRequested = false,
  onEditingRequestedHandled,
  onSessionExpired,
}: PersonalInfoSectionProps) {
  const m = useMessages();
  const { refreshUser } = useAuth();

  const currentName = user.name?.trim() ?? '';
  const currentEmail = displayEmail(user.email) ?? '';

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [email, setEmail] = useState(currentEmail);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveState, setSaveState] = useState<AsyncState>('idle');

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setName(currentName);
      setEmail(currentEmail);
    }
  }, [currentName, currentEmail, isEditing]);

  useEffect(() => {
    if (editingRequested) {
      setIsEditing(true);
      setSaveSuccess(false);
      setNameError(null);
      setEmailError(null);
      setFormError(null);
      onEditingRequestedHandled?.();
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }, [editingRequested, onEditingRequestedHandled]);

  const startEditing = () => {
    setName(currentName);
    setEmail(currentEmail);
    setNameError(null);
    setEmailError(null);
    setFormError(null);
    setSaveSuccess(false);
    setIsEditing(true);
    requestAnimationFrame(() => nameRef.current?.focus());
  };

  const cancelEditing = () => {
    setName(currentName);
    setEmail(currentEmail);
    setNameError(null);
    setEmailError(null);
    setFormError(null);
    setIsEditing(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saveState === 'pending') return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    let hasError = false;

    if (trimmedName.length < 2) {
      setNameError(m.profileNameInvalid);
      hasError = true;
    } else {
      setNameError(null);
    }

    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      setEmailError(m.profileEmailInvalid);
      hasError = true;
    } else {
      setEmailError(null);
    }

    if (hasError) return;

    setFormError(null);
    setSaveState('pending');

    try {
      await auth.updateProfile({
        name: trimmedName,
        email: trimmedEmail || null,
      });
      await refreshUser();
      setSaveState('idle');
      setIsEditing(false);
      setSaveSuccess(true);
    } catch (err: unknown) {
      setSaveState('idle');
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        onSessionExpired?.();
        return;
      }
      const code = apiErrorCode(err);
      if (status === 409 || code === 'EMAIL_ALREADY_IN_USE') {
        setEmailError(m.profileEmailInUse);
        return;
      }
      if (code === 'INVALID_EMAIL') {
        setEmailError(m.profileEmailInvalid);
        return;
      }
      if (code === 'INVALID_NAME') {
        setNameError(m.profileNameInvalid);
        return;
      }
      setFormError(m.profileSaveFailed);
    }
  };

  return (
    <section
      id="account-personal"
      aria-labelledby="profile-personal-heading"
      className="scroll-mt-24 rounded-card border border-line bg-linen p-5 md:p-6"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2
            id="profile-personal-heading"
            className="m-0 font-display text-22 font-extrabold leading-28 text-ink"
          >
            {m.profilePersonalTitle}
          </h2>
          <p className="m-0 mt-1 text-14 leading-22 text-stone">{m.profilePersonalSubtitle}</p>
        </div>
        {!isEditing ? (
          <Button type="button" variant="ghost" size="s" onClick={startEditing}>
            {m.profileEditAction}
          </Button>
        ) : null}
      </div>

      {saveSuccess && !isEditing ? (
        <MessageBox tone="ok" className="mb-4" role="status">
          {m.profileSavedSuccess}
        </MessageBox>
      ) : null}

      {isEditing ? (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError ? <MessageBox tone="err">{formError}</MessageBox> : null}

          <TextField
            ref={nameRef}
            id="profile-name-input"
            label={m.profileFullNameLabel}
            placeholder={m.authNamePlaceholder}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            error={nameError ?? undefined}
            autoComplete="name"
            maxLength={80}
          />

          <TextField
            id="profile-email-input"
            type="email"
            dir="ltr"
            label={m.profileEmailLabel}
            optionalLabel={m.checkoutOptional}
            placeholder={m.profileEmailPlaceholder}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
            }}
            error={emailError ?? undefined}
            autoComplete="email"
            maxLength={160}
          />

          <div className="rounded-input border border-line bg-chalk/70 px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2 text-14">
              <span className="font-semibold text-stone">{m.checkoutPhone}</span>
              {user.phoneNumber ? (
                <bdi dir="ltr" className="font-display font-bold tabular-nums text-ink">
                  {displayMobile(user.phoneNumber)}
                </bdi>
              ) : null}
            </div>
            <p className="m-0 mt-1 text-12 leading-18 text-stone">{m.profilePhoneImmutableHint}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <AsyncButton
              type="submit"
              variant="cobalt"
              size="m"
              state={saveState}
              pendingLabel={m.profileSavingChanges}
            >
              {m.profileSaveChanges}
            </AsyncButton>
            <Button
              type="button"
              variant="ghost"
              size="m"
              onClick={cancelEditing}
              disabled={saveState === 'pending'}
            >
              {m.profileAddressCancel}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="m-0 divide-y divide-line">
          <div className="flex flex-col gap-0.5 pb-3">
            <dt className="text-13 font-medium text-stone">{m.profileFullNameLabel}</dt>
            <dd className="m-0 font-display text-16 font-semibold text-ink">
              {currentName || <span className="font-normal text-stone">{m.profileNameNotAdded}</span>}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 py-3">
            <dt className="text-13 font-medium text-stone">{m.profileEmailLabel}</dt>
            <dd className="m-0 text-15 font-medium text-ink">
              {currentEmail ? (
                <bdi dir="ltr">{currentEmail}</bdi>
              ) : (
                <span className="text-stone">{m.profileEmailNotAdded}</span>
              )}
            </dd>
          </div>

          <div className="flex flex-col gap-1 pt-3">
            <dt className="text-13 font-medium text-stone">{m.checkoutPhone}</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2">
              {user.phoneNumber ? (
                <bdi dir="ltr" className="font-display text-16 font-bold tabular-nums text-ink">
                  {displayMobile(user.phoneNumber)}
                </bdi>
              ) : null}
              <span className="inline-flex items-center gap-1 rounded-pill bg-ok-tint px-2 py-0.5 text-12 font-semibold text-ok">
                <Icon name="check" size={12} strokeWidth={2.5} />
                <span>{m.profileVerifiedMobile}</span>
              </span>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
