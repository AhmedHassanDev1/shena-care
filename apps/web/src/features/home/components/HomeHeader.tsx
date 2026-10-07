import { Menu, Bell, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function HomeHeader() {
  return (
    <header className="flex items-center justify-between px-4 py-3 bg-background">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Open menu">
          <Menu className="w-6 h-6" />
        </Button>
        <div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <span>Hello, Glow Girl!</span>
            <span>✨</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Discover Beauty</h1>
          <p className="text-xs text-muted-foreground">Guidance for your skin & hair</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell className="w-6 h-6" />
          </Button>
          <Badge className="absolute top-1 right-1 w-4 h-4 p-0 flex items-center justify-center text-[10px] bg-destructive text-destructive-foreground">
            3
          </Badge>
        </div>
        <Button variant="ghost" size="icon" aria-label="Shopping Cart">
          <ShoppingBag className="w-6 h-6" />
        </Button>
      </div>
    </header>
  );
}
