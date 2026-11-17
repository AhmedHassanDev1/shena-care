'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/messages';

export type VoiceErrorKind = 'unsupported' | 'denied' | 'error' | null;

interface SpeechRecognitionResultAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionResultAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export interface UseVoiceInputOptions {
  locale: Locale;
  onTranscript: (text: string, isFinal: boolean) => void;
}

export function useVoiceInput({ locale, onTranscript }: UseVoiceInputOptions) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [errorKind, setErrorKind] = useState<VoiceErrorKind>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const baseTextRef = useRef('');
  const latestTranscriptRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    const active = recognitionRef.current;
    if (active) {
      try {
        active.stop();
      } catch {
        setIsListening(false);
      }
    } else {
      setIsListening(false);
    }
  }, [clearSilenceTimer]);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    // 15 seconds of complete silence before auto-stopping
    silenceTimerRef.current = setTimeout(() => {
      stopListening();
    }, 15000);
  }, [clearSilenceTimer, stopListening]);

  useEffect(() => {
    setIsSupported(Boolean(getSpeechRecognitionConstructor()));
    return () => {
      clearSilenceTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore teardown abort errors when recognition already stopped.
      }
      recognitionRef.current = null;
    };
  }, [clearSilenceTimer]);

  const clearError = useCallback(() => {
    setErrorKind(null);
  }, []);

  const startListening = useCallback(
    (currentText?: string | unknown) => {
      const Recognition = getSpeechRecognitionConstructor();
      if (!Recognition) {
        setErrorKind('unsupported');
        setIsListening(false);
        return;
      }

      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore abort on prior session.
        }
      }

      setErrorKind(null);
      baseTextRef.current = typeof currentText === 'string' ? currentText.trim() : '';
      latestTranscriptRef.current = '';

      const recognition = new Recognition();
      recognition.lang = locale === 'ar' ? 'ar-EG' : 'en-US';
      recognition.interimResults = true;
      recognition.continuous = true;

      recognition.onstart = () => {
        setIsListening(true);
        resetSilenceTimer();
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        resetSilenceTimer();

        const finalParts: string[] = [];
        const interimParts: string[] = [];

        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const phrase = result?.[0]?.transcript?.trim();
          if (!phrase) continue;
          if (result.isFinal) {
            finalParts.push(phrase);
          } else {
            interimParts.push(phrase);
          }
        }

        const finalTranscript = finalParts.join(' ');
        const interimTranscript = interimParts.join(' ');
        const sessionTranscript = [finalTranscript, interimTranscript].filter(Boolean).join(' ').trim();

        if (sessionTranscript) {
          latestTranscriptRef.current = sessionTranscript;
          const fullText = baseTextRef.current
            ? `${baseTextRef.current} ${sessionTranscript}`
            : sessionTranscript;
          onTranscriptRef.current(fullText, Boolean(finalTranscript && !interimTranscript));
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        clearSilenceTimer();
        const code = event.error ?? '';
        if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
          setErrorKind('denied');
        } else if (code !== 'aborted' && code !== 'no-speech') {
          setErrorKind('error');
        }
        setIsListening(false);

        // Preserve already captured transcript even if the native UI was closed or aborted
        if (latestTranscriptRef.current) {
          const fullText = baseTextRef.current
            ? `${baseTextRef.current} ${latestTranscriptRef.current}`
            : latestTranscriptRef.current;
          onTranscriptRef.current(fullText, true);
        }
      };

      recognition.onend = () => {
        clearSilenceTimer();
        setIsListening(false);
        recognitionRef.current = null;

        // Ensure captured transcript is permanently committed
        if (latestTranscriptRef.current) {
          const fullText = baseTextRef.current
            ? `${baseTextRef.current} ${latestTranscriptRef.current}`
            : latestTranscriptRef.current;
          onTranscriptRef.current(fullText, true);
        }
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
        setIsListening(false);
        setErrorKind('error');
      }
    },
    [clearSilenceTimer, locale, resetSilenceTimer],
  );

  return {
    isSupported,
    isListening,
    errorKind,
    startListening,
    stopListening,
    clearError,
  };
}
