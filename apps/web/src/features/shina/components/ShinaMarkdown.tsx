'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface ShinaMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Parses inline formatting (**bold**, [label](url), `code`) safely into React nodes.
 */
function parseInline(text: string): React.ReactNode[] {
  // Regex matches:
  // 1. **bold** -> (?:\\*\\*(.+?)\\*\\*)
  // 2. [text](url) -> (?:\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+|\\/[^\\s)]+)\\))
  // 3. `code` -> (?:`([^`]+)`)
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:https?:\/\/[^\s)]+|\/[^\s)]+)\)|`[^`]+`)/g;
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    if (!part) return null;

    // Bold **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={index} className="font-bold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }

    // Link [label](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/[^\s)]+|\/[^\s)]+))\)$/);
    if (linkMatch) {
      const [, label, url] = linkMatch;
      const isExternal = url.startsWith('http');
      return (
        <a
          key={index}
          href={url}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          className="font-medium text-cobalt underline decoration-1 underline-offset-2 transition-colors hover:text-cobalt-deep"
        >
          {label}
        </a>
      );
    }

    // Inline code `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={index}
          className="rounded border border-line/60 bg-sand/30 px-1.5 py-0.5 text-12 text-ink"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return part;
  });
}

/**
 * Editorial, safe markdown renderer tailored for ShinaCare consultation responses.
 * Renders paragraphs, bullet lists, numbered steps, bold text, and links cleanly.
 */
export function ShinaMarkdown({ content, className }: ShinaMarkdownProps) {
  const elements = useMemo(() => {
    if (!content) return null;

    // Normalize line endings
    const rawLines = content.replace(/\r\n/g, '\n').split('\n');
    const nodes: React.ReactNode[] = [];

    let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
    let paragraphLines: string[] = [];

    const flushParagraph = () => {
      if (paragraphLines.length > 0) {
        const text = paragraphLines.join('\n').trim();
        if (text) {
          nodes.push(
            <p key={`p-${nodes.length}`} className="leading-relaxed">
              {text.split('\n').map((line, lIdx, allLines) => (
                <React.Fragment key={lIdx}>
                  {parseInline(line)}
                  {lIdx < allLines.length - 1 ? <br /> : null}
                </React.Fragment>
              ))}
            </p>,
          );
        }
        paragraphLines = [];
      }
    };

    const flushList = () => {
      if (currentList && currentList.items.length > 0) {
        const isOl = currentList.type === 'ol';
        nodes.push(
          isOl ? (
            <ol
              key={`list-${nodes.length}`}
              className="my-2 space-y-1.5 list-decimal ps-5 leading-relaxed marker:font-bold marker:text-cobalt"
            >
              {currentList.items.map((item, iIdx) => (
                <li key={iIdx} className="ps-1">
                  {parseInline(item)}
                </li>
              ))}
            </ol>
          ) : (
            <ul
              key={`list-${nodes.length}`}
              className="my-2 space-y-1.5 list-disc ps-5 leading-relaxed marker:text-stone"
            >
              {currentList.items.map((item, iIdx) => (
                <li key={iIdx} className="ps-1">
                  {parseInline(item)}
                </li>
              ))}
            </ul>
          ),
        );
        currentList = null;
      }
    };

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const trimmed = line.trim();

      // Empty line -> flush active blocks
      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }

      // Check for bullet list item (- item, * item, • item)
      const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
      if (bulletMatch) {
        flushParagraph();
        if (currentList && currentList.type !== 'ul') {
          flushList();
        }
        if (!currentList) {
          currentList = { type: 'ul', items: [] };
        }
        currentList.items.push(bulletMatch[1]);
        continue;
      }

      // Check for numbered list item (1. item, 2. item)
      const numMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
      if (numMatch) {
        flushParagraph();
        if (currentList && currentList.type !== 'ol') {
          flushList();
        }
        if (!currentList) {
          currentList = { type: 'ol', items: [] };
        }
        currentList.items.push(numMatch[1]);
        continue;
      }

      // Normal paragraph line
      if (currentList) {
        flushList();
      }
      paragraphLines.push(line);
    }

    flushParagraph();
    flushList();

    return nodes;
  }, [content]);

  return <div className={cn('space-y-3 font-text text-14 leading-relaxed text-ink sm:text-15', className)}>{elements}</div>;
}
