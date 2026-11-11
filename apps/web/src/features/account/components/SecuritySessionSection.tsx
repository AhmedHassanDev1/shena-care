'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useAuth } from '@/features/auth/AuthContext';
import type { User } from '@/lib/auth';
import { formatDate } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';

export interface SecuritySessionSectionProps {
  user: User;
}

/**
 * Account & Security section: SMS OTP verification status, membership date,
 * and server-revoking sign-out action with clear loading feedback.
 */
export function SecuritySessionSection({ user }: SecuritySessionSectionProps) {
  const m = useMessages();
  const locale = useLocale();
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <section
      id="account-security"
      aria-labelledby="profile-security-heading"
      className="scroll-mt-24 rounded-card border border-line bg-chalk p-5 md:p-6"
    >
      <h2
        id="profile-security-heading"
        className="m-0 font-display text-22 font-extrabold leading-28 text-ink"
      >
        {m.profileSecurityTitle}
      </h2>

      <div className="mt-4 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 flex-none place-items-center rounded-pill bg-ok-tint text-ok"
        >
          <Icon name="shield" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 font-display text-15 font-bold text-ink">{m.profileSecurityOtpTitle}</p>
          <p className="m-0 mt-1 text-14 leading-22 text-stone">{m.profileSecurityOtpBody}</p>
          {user.createdAt ? (
            <p className="m-0 mt-2 text-13 text-stone">
              {fillMessage(m.profileMemberSince, { date: formatDate(user.createdAt, locale) })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className="m-0 mb-3 text-13 leading-18 text-stone">{m.profileSignOutHint}</p>
        <Button
          type="button"
          variant="linen"
          size="m"
          loading={signingOut}
          pendingLabel={m.shellSigningOut}
          onClick={() => void handleSignOut()}
          className="w-full justify-center border border-line sm:w-auto"
        >
          <Icon name="logout" size={18} />
          <span>{m.authSignOut}</span>
        </Button>
      </div>
    </section>
  );
}
