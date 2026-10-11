'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import contrastPairs from '@/styles/contrast-pairs.json';

type Pair = { fg: string; bg: string; min: number | null; note?: string };
const PAIRS = contrastPairs.pairs as Pair[];

function luminance(rgb: number[]) {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: number[], b: number[]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Reads the tokens as the browser resolved them, so the table reflects the active theme. */
export function ContrastTable() {
  const [rows, setRows] = useState<(Pair & { ratio: number })[] | null>(null);

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(`--${name}`).trim().split(/\s+/).map(Number);
    setRows(PAIRS.map((pair) => ({ ...pair, ratio: ratio(read(pair.fg), read(pair.bg)) })));
  }, []);

  if (!rows) return <p className="text-support text-muted-foreground">Measuring rendered tokens…</p>;

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[34rem] text-start text-support">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-start font-medium">Sample</th>
            <th className="px-3 py-2 text-start font-medium">Foreground / background</th>
            <th className="px-3 py-2 text-end font-medium">Ratio</th>
            <th className="px-3 py-2 text-end font-medium">Required</th>
            <th className="px-3 py-2 text-end font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pass = row.min == null ? null : row.ratio >= row.min;
            return (
              <tr key={`${row.fg}-${row.bg}-${row.min}`} className="border-t border-border">
                <td className="px-3 py-2">
                  <span
                    className="inline-flex h-8 min-w-16 items-center justify-center rounded-sm px-2 font-medium"
                    style={{ color: `rgb(var(--${row.fg}))`, backgroundColor: `rgb(var(--${row.bg}))` }}
                  >
                    Aa نص
                  </span>
                </td>
                <td className="px-3 py-2">
                  <code className="text-caption">{row.fg}</code> / <code className="text-caption">{row.bg}</code>
                  {row.note ? <span className="block text-caption text-muted-foreground">{row.note}</span> : null}
                </td>
                <td className="px-3 py-2 text-end tabular-nums">{row.ratio.toFixed(2)}:1</td>
                <td className="px-3 py-2 text-end tabular-nums">{row.min == null ? '—' : `${row.min}:1`}</td>
                <td className="px-3 py-2 text-end">
                  {pass === null ? (
                    <Badge variant="secondary">Info</Badge>
                  ) : pass ? (
                    <Badge variant="success">Pass</Badge>
                  ) : (
                    <Badge variant="destructive">Fail</Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
