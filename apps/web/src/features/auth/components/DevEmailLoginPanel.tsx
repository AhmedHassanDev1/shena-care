'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AsyncButton, type AsyncState } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { MessageBox } from '@/components/ui/message-box';
import { auth, type User } from '@/lib/auth';
import { useMessages } from '@/lib/i18n/LocaleProvider';

interface DevEmailLoginPanelProps {
  onSuccess: (user: User) => void | Promise<void>;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Isolated local development login panel for developer accounts (`ADMIN` email/password),
 * rendered only when NODE_ENV !== 'production', NEXT_PUBLIC_DEV_TEST_REVIEWS === 'true',
 * and on a local hostname. Never active in production builds.
 */
export function DevEmailLoginPanel({ onSuccess }: DevEmailLoginPanelProps) {
  const m = useMessages();
  const [mountedLocal, setMountedLocal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [state, setState] = useState<AsyncState>('idle');

  const flagEnabled =
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_DEV_TEST_REVIEWS === 'true';

  useEffect(() => {
    if (!flagEnabled || typeof window === 'undefined') return;
    if (LOCAL_HOSTNAMES.has(window.location.hostname.toLowerCase())) {
      setMountedLocal(true);
    }
  }, [flagEnabled]);

  if (!flagEnabled || !mountedLocal) {
    return null;
  }

  async function handleDevSubmit(event: FormEvent) {
    event.preventDefault();
    if (state === 'pending') return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError(m.authDevLoginError);
      return;
    }

    setError('');
    setState('pending');
    try {
      await auth.login({ email: trimmedEmail, password });
      const user = await auth.getMe();
      setState('success');
      await onSuccess(user);
    } catch {
      setState('idle');
      setError(m.authDevLoginError);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full text-center text-12 font-semibold text-stone hover:text-ink underline-offset-4 hover:underline"
      >
        {m.authDevLoginToggle}
      </button>

      {expanded ? (
        <form onSubmit={handleDevSubmit} noValidate className="mt-3 flex flex-col gap-3">
          <TextField
            label={m.authDevEmailLabel}
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dev.reviewer@shinacare.local"
          />
          <TextField
            label={m.authDevPasswordLabel}
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? (
            <MessageBox tone="err" role="alert">
              <p className="m-0 text-13 text-ink">{error}</p>
            </MessageBox>
          ) : null}
          <AsyncButton
            type="submit"
            variant="light"
            size="s"
            state={state}
            pendingLabel={m.pdpReviewSubmitting}
            className="w-full rounded-pill"
          >
            {m.authDevSignInButton}
          </AsyncButton>
        </form>
      ) : null}
    </div>
  );
}
