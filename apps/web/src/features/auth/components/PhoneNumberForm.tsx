'use client';

import React, { useState } from 'react';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BrandLogo } from './BrandLogo';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';

export function PhoneNumberForm() {
  const m = useMessages();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const returnTo = searchParams.get('returnTo') || '';
  const intent = searchParams.get('intent') || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Basic validation
    const digitsOnly = phoneNumber.replace(/\D/g, '');
    if (digitsOnly.length < 8) {
      setError('Please enter a valid phone number');
      return;
    }

    // Format with +20 for Egypt for now
    // Later this should be dynamic based on selected country
    const formattedPhone = `+20${digitsOnly}`;

    setIsLoading(true);
    try {
      await auth.sendOtp(formattedPhone);
      
      const params = new URLSearchParams();
      params.set('phone', formattedPhone);
      if (returnTo) params.set('returnTo', returnTo);
      if (intent) params.set('intent', intent);
      
      router.push(`/auth/verify?${params.toString()}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to send verification code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full">
      <div className="mb-8 hidden md:block">
        <BrandLogo />
      </div>
      
      <h2 className="text-3xl font-serif text-norya-stone-900 mb-2 text-center tracking-tight">
        {m.authWelcome}
      </h2>
      <p className="text-[15px] text-norya-stone-600 mb-10 text-center">
        {m.authSubtitle}
      </p>

      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label htmlFor="phone" className="text-sm font-medium text-norya-stone-900">
            {m.authPhoneLabel}
          </label>
          
          <div className="flex flex-row items-center border border-norya-border rounded-xl focus-within:ring-2 focus-within:ring-norya-primary focus-within:border-norya-primary transition-all bg-white h-14 overflow-hidden relative">
            
            {/* Country Selector (Static for MVP) */}
            <div className="flex items-center gap-2 px-4 border-l border-norya-border h-full bg-norya-muted/30 shrink-0 select-none cursor-default" dir="ltr">
              <span className="text-xl leading-none">🇪🇬</span>
              <span className="text-norya-stone-900 font-medium">+20</span>
              <ChevronDown className="w-4 h-4 text-norya-stone-400" />
            </div>

            <input
              id="phone"
              type="tel"
              value={phoneNumber}
              onChange={(e) => {
                const val = e.target.value.replace(/[^\d\s-]/g, '');
                setPhoneNumber(val);
                if (error) setError('');
              }}
              placeholder={m.authPhonePlaceholder}
              className="flex-1 h-full px-4 outline-none text-lg text-norya-stone-900 placeholder:text-norya-stone-400"
              dir="ltr"
              autoFocus
              required
            />
          </div>
          
          {error && (
            <p className="text-sm text-[#C62828] mt-1 font-medium">{error}</p>
          )}
          {!error && (
            <p className="text-[13px] text-norya-stone-600 mt-1">
              {m.authPhoneInfo}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading || !phoneNumber}
          className="w-full h-14 bg-[#D47F7B] hover:bg-[#C26B67] text-white rounded-xl font-medium text-lg transition-colors flex items-center justify-center disabled:opacity-50"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            m.authContinue
          )}
        </button>

        <div className="mt-6 text-center text-[13px] text-norya-stone-600">
          {m.authTermsAgreement} <br />
          <Link href="/terms" className="text-[#D47F7B] hover:underline font-medium">{m.termsOfService}</Link> {m.and} <Link href="/privacy" className="text-[#D47F7B] hover:underline font-medium">{m.privacyPolicy}</Link>
        </div>
      </form>
    </div>
  );
}
