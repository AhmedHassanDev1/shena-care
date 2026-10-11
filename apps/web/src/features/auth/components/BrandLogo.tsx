import React from 'react';

export function BrandLogo() {
  return (
    <div className="flex items-center gap-2">
      {/* Temporary Neutral Placeholder mark */}
      <div className="w-8 h-8 rounded-full bg-accent-foreground/20 flex items-center justify-center shrink-0">
        <div className="w-4 h-4 bg-accent-foreground rounded-full opacity-60" />
      </div>
      <span className="text-2xl font-serif font-medium text-foreground tracking-tight">Shena Care</span>
    </div>
  );
}
