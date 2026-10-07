'use client';

import React from 'react';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { BrandLogo } from './BrandLogo';
import { Globe } from 'lucide-react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';

export function AuthShell({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const m = useMessages();
  const router = useRouter();
  const pathname = usePathname();
  
  // Basic language toggle for auth shell
  const nextLocale = locale === 'en' ? 'ar' : 'en';

  const changeLocale = () => {
    document.cookie = `shena-locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = nextLocale;
    document.documentElement.dir = nextLocale === 'ar' ? 'rtl' : 'ltr';
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-norya-canvas flex flex-col md:flex-row text-norya-stone-900">
      
      {/* Mobile Header / Desktop Left Panel */}
      <div className="relative w-full md:w-1/2 lg:w-[45%] h-[40vh] md:h-screen flex-shrink-0 bg-norya-muted overflow-hidden">
        {/* We use a temporary solid color / gradient since we don't have final assets */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#EAE0D8] to-[#F6EFEA]" />
        
        {/* Placeholder image representation - we use CSS rather than hardcoding a screenshot */}
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1620916566398-39f1143ab7be?q=80&w=1000&auto=format&fit=crop')] bg-cover bg-center opacity-40 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-norya-canvas md:bg-none" />

        <div className="relative z-10 p-6 md:p-12 h-full flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <BrandLogo />
            </Link>
            
            {/* Language Switcher - Mobile only (Desktop is in the right card) */}
            <div className="md:hidden">
              <button 
                type="button"
                onClick={changeLocale}
                className="flex items-center gap-1.5 text-sm font-medium bg-white/50 backdrop-blur-md px-3 py-1.5 rounded-full"
              >
                {locale === 'en' ? 'AR' : 'EN'}
              </button>
            </div>
          </div>

          <div className="hidden md:block max-w-md mt-auto pb-12">
             <h1 className="text-4xl lg:text-5xl font-serif text-norya-stone-900 mb-4 leading-tight">
               Care that stays with you.
             </h1>
             <p className="text-lg text-norya-stone-600 mb-8">
               Your routine, products, and care progress — all in one place.
             </p>
             
             <div className="space-y-6">
               <div className="flex items-start gap-4">
                 <div className="w-10 h-10 rounded-full bg-norya-primary-light flex items-center justify-center shrink-0">
                    <span className="text-norya-primary font-bold text-xl">1</span>
                 </div>
                 <div>
                   <h3 className="font-medium text-norya-stone-900">Personalized recommendations</h3>
                 </div>
               </div>
               <div className="flex items-start gap-4">
                 <div className="w-10 h-10 rounded-full bg-norya-primary-light flex items-center justify-center shrink-0">
                    <span className="text-norya-primary font-bold text-xl">2</span>
                 </div>
                 <div>
                   <h3 className="font-medium text-norya-stone-900">Save your favorites and reorder easily</h3>
                 </div>
               </div>
             </div>
          </div>
        </div>
      </div>

      {/* Right Card / Mobile Bottom Sheet */}
      <div className="relative flex-1 w-full bg-norya-canvas md:bg-white flex flex-col min-h-[60vh] -mt-6 md:mt-0 rounded-t-[32px] md:rounded-none z-20 overflow-hidden">
        <div className="absolute top-6 right-8 hidden md:block">
           {/* Desktop Language Switcher */}
           <button 
             type="button"
             onClick={changeLocale}
             className="flex items-center gap-2 text-sm font-medium text-norya-stone-600 hover:text-norya-stone-900 transition-colors"
           >
             <Globe className="w-4 h-4" />
             {locale === 'en' ? 'العربية' : 'English'}
           </button>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-[440px] mx-auto w-full p-6 md:p-12">
          {children}
        </div>
      </div>

    </div>
  );
}
