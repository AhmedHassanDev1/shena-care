'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { Toast } from '@/components/ui/toast';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { consumeAuthReturn } from '../lib/auth-return';

const VISIBLE_MS = 4000;

/**
 * «دخلت بحسابك. كمّل طلبك من مكان ما وقفت.» on the page sign-in returned to (AuthMobile ٣, AuthStates §٥): under the
 * page header, announced politely, gone after a few seconds. Mounted once for the storefront.
 */
export function AuthReturnToast() {
  const m = useMessages();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (consumeAuthReturn('signed-in')) setVisible(true);
  }, [pathname]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 top-16 z-toast flex justify-center lg:top-20">
      <Toast className="pointer-events-auto w-full lg:w-[420px]">
        <span className="flex items-center gap-2.5">
          <span className="grid size-5 flex-none place-items-center rounded-pill bg-ok text-white">
            <Icon name="check" size={13} strokeWidth={2.6} />
          </span>
          {m.authReturnToast}
        </span>
      </Toast>
    </div>
  );
}
