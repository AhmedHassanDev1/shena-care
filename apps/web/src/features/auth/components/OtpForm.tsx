'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useMessages, useLocale } from '@/lib/i18n/LocaleProvider';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth } from '@/lib/auth';
import { useAuth } from '../AuthContext';
import { BrandLogo } from './BrandLogo';

function OtpFormContent() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();
  
  const phoneNumber = searchParams.get('phone');
  const returnTo = searchParams.get('returnTo') || '/';
  
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(30);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!phoneNumber) {
      router.replace('/auth');
    }
  }, [phoneNumber, router]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  if (!phoneNumber) return null;

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    
    const newCode = [...code];
    newCode[index] = value.substring(value.length - 1);
    setCode(newCode);
    setError('');

    // Move to next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
    
    // Auto submit when 6 digits are entered
    if (value && index === 5 && newCode.every(d => d !== '')) {
      handleSubmit(newCode.join(''));
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pastedData) return;
    
    const newCode = [...code];
    for (let i = 0; i < pastedData.length; i++) {
      newCode[i] = pastedData[i];
    }
    setCode(newCode);
    
    const focusIndex = Math.min(pastedData.length, 5);
    inputRefs.current[focusIndex]?.focus();
    
    if (pastedData.length === 6) {
      handleSubmit(pastedData);
    }
  };

  const handleSubmit = async (submittedCode: string) => {
    if (submittedCode.length !== 6) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      await auth.verifyOtp(phoneNumber, submittedCode);
      await refreshUser();
      
      // Verification successful, redirect
      router.push(returnTo);
    } catch (err: any) {
      setError(err?.message || 'Invalid verification code');
      // Clear inputs on error
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    
    setIsLoading(true);
    setError('');
    try {
      await auth.sendOtp(phoneNumber);
      setCountdown(30);
    } catch (err: any) {
      setError(err?.message || 'Failed to resend code');
    } finally {
      setIsLoading(false);
    }
  };

  const codeString = code.join('');

  return (
    <div className="flex flex-col items-center w-full">
      <div className="mb-8 hidden md:block">
        <BrandLogo />
      </div>
      
      <h2 className="text-3xl font-serif text-norya-stone-900 mb-2 text-center tracking-tight">
        {m.authVerifyTitle}
      </h2>
      <p className="text-[15px] text-norya-stone-600 mb-10 text-center flex flex-col items-center">
        <span>{m.authVerifySubtitle}</span>
        <span className="font-medium text-norya-stone-900 mt-1" dir="ltr">{phoneNumber}</span>
        <button 
          onClick={() => router.back()}
          className="text-[#D47F7B] hover:underline text-sm font-medium mt-2"
        >
          {m.authChangePhone}
        </button>
      </p>

      <form 
        onSubmit={(e) => { 
          e.preventDefault(); 
          handleSubmit(codeString); 
        }} 
        className="w-full flex flex-col gap-8"
      >
        <div className="flex flex-col gap-2">
          <div className="flex justify-center gap-2 md:gap-3 w-full" dir="ltr">
            {code.map((digit, index) => (
              <input
                key={index}
                ref={(el) => { inputRefs.current[index] = el; }}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={index === 0 ? handlePaste : undefined}
                className={`w-12 h-14 md:w-14 md:h-16 text-center text-2xl font-medium rounded-xl border focus:ring-2 focus:ring-norya-primary focus:border-norya-primary transition-all bg-white outline-none ${
                  error ? 'border-[#C62828] text-[#C62828]' : 'border-norya-border text-norya-stone-900'
                }`}
                autoFocus={index === 0}
              />
            ))}
          </div>
          
          {error && (
            <p className="text-sm text-[#C62828] mt-2 font-medium text-center">{error}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading || codeString.length !== 6}
          className="w-full h-14 bg-[#D47F7B] hover:bg-[#C26B67] text-white rounded-xl font-medium text-lg transition-colors flex items-center justify-center disabled:opacity-50"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            m.authVerifyCode
          )}
        </button>

        <div className="text-center text-[14px]">
          <span className="text-norya-stone-600">{m.authCodeNotReceived}</span>{' '}
          <button
            type="button"
            disabled={countdown > 0 || isLoading}
            onClick={handleResend}
            className="font-medium disabled:opacity-50 text-[#D47F7B] hover:underline"
          >
            {countdown > 0 
              ? m.authResendIn.replace('{time}', `0:${countdown.toString().padStart(2, '0')}`) 
              : m.authResendNow}
          </button>
        </div>
      </form>
    </div>
  );
}

export function OtpForm() {
  return (
    <Suspense fallback={<div className="h-[400px] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#D47F7B] border-t-transparent rounded-full animate-spin" /></div>}>
      <OtpFormContent />
    </Suspense>
  );
}
