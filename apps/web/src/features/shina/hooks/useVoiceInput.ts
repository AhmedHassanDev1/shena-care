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

  useEffect(() => {
    setIsSupported(Boolean(getSpeechRecognitionConstructor()));
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore teardown abort errors when recognition already stopped.
      }
      recognitionRef.current = null;
    };
  }, []);

  const clearError = useCallback(() => {
    setErrorKind(null);
  }, []);

  const stopListening = useCallback(() => {
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
  }, []);

  const startListening = useCallback(() => {
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
    const recognition = new Recognition();
    recognition.lang = locale === 'ar' ? 'ar-EG' : 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let combined = '';
      let isFinal = false;
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.[0]?.transcript) {
          combined += `${result[0].transcript} `;
        }
        if (result?.isFinal) {
          isFinal = true;
        }
      }
      const cleaned = combined.trim();
      if (cleaned) {
        onTranscriptRef.current(cleaned, isFinal);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      const code = event.error ?? '';
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
        setErrorKind('denied');
      } else if (code !== 'aborted' && code !== 'no-speech') {
        setErrorKind('error');
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setErrorKind('error');
    }
  }, [locale]);

  return {
    isSupported,
    isListening,
    errorKind,
    startListening,
    stopListening,
    clearError,
  };
}
