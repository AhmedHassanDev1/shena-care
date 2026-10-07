import Link from 'next/link';

export function BrandLogo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-xl font-serif text-norya-stone-900">
      <div className="w-6 h-6 rounded-full bg-[#E57A73]/20 flex items-center justify-center">
        <div className="w-3 h-3 bg-[#E57A73] rounded-full opacity-60" />
      </div>
      ShinaCare
    </Link>
  );
}
