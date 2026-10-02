'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Global application error:', error);
  }, [error]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      textAlign: 'center',
      padding: '2rem'
    }}>
      <div style={{
        background: '#fee2e2',
        color: '#991b1b',
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '2rem',
        marginBottom: '1rem'
      }}>
        !
      </div>
      <h2 style={{ marginBottom: '1rem' }}>Something went wrong!</h2>
      <p style={{ color: 'var(--color-text-light)', maxWidth: '400px', marginBottom: '2rem' }}>
        We've encountered an unexpected issue. Our technical team has been notified.
        {error.digest && <span style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.8rem' }}>Error ID: {error.digest}</span>}
      </p>
      
      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          onClick={() => reset()}
          className="cta-button"
          style={{ background: 'var(--color-primary)' }}
        >
          Try again
        </button>
        <a 
          href={`/support?errorId=${error.digest || 'unknown'}`} 
          className="cta-button" 
          style={{ background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
        >
          Contact Support
        </a>
      </div>
    </div>
  );
}
