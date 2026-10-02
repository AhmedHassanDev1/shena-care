'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await auth.sendOtp(phoneNumber);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await auth.verifyOtp(phoneNumber, otp);
      router.push('/account'); // redirect to account profile
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid OTP code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">{step === 1 ? 'Login / Register' : 'Verify OTP'}</h1>
        <p className="auth-subtitle">
          {step === 1 ? 'Enter your phone number to continue' : `Enter the 6-digit code sent to ${phoneNumber}`}
        </p>

        {error && <div className="error-message">{error}</div>}

        {step === 1 ? (
          <form onSubmit={handleSendOtp} className="auth-form">
            <div className="form-field">
              <label htmlFor="phone">Phone Number</label>
              <input
                id="phone"
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+201000000000"
              />
            </div>
            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Sending...' : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="auth-form">
            <div className="form-field">
              <label htmlFor="otp">6-digit Code</label>
              <input
                id="otp"
                type="text"
                required
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
              />
            </div>
            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Verifying...' : 'Verify & Continue'}
            </button>
            <button
              type="button"
              className="auth-link"
              onClick={() => setStep(1)}
              style={{ marginTop: '1rem', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Change Phone Number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
