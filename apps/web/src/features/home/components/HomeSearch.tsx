'use client';

import { Search, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { routes } from '@/lib/routes';

export function HomeSearch() {
  const router = useRouter();

  const handleSearchClick = () => {
    // Navigate to dedicated search/products page on click for now
    router.push(routes.products);
  };

  return (
    <div className="px-4 py-2 flex items-center gap-2">
      <div className="relative flex-1" onClick={handleSearchClick}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input 
          type="text" 
          placeholder="Search for products, concerns, routines..." 
          className="pl-9 bg-muted/30 border-muted/50 rounded-full h-11 text-sm pointer-events-none"
          readOnly
        />
      </div>
      <Button variant="outline" size="icon" className="rounded-full h-11 w-11 shrink-0 border-muted/50">
        <SlidersHorizontal className="w-5 h-5 text-foreground" />
      </Button>
    </div>
  );
}
