/**
 * useKeyboardShortcuts Hook
 *
 * Global keyboard shortcuts for Wheelhaus control surface.
 * Makes the UI feel native and efficient for power users.
 */

import { useEffect, useCallback, useState } from 'react';

export interface KeyboardShortcut {
  key: string;
  description: string;
  modifiers?: ('ctrl' | 'meta' | 'shift' | 'alt')[];
}

export const WHEELHAUS_SHORTCUTS: KeyboardShortcut[] = [
  { key: 'r', description: 'Refresh data' },
  { key: '?', description: 'Show keyboard shortcuts' },
  { key: '1', description: 'Focus Sessions panel' },
  { key: '2', description: 'Focus Decisions panel' },
  { key: '3', description: 'Focus Tasks panel' },
  { key: '4', description: 'Focus Health panel' },
  { key: '5', description: 'Focus Chat panel' },
  { key: 'n', description: 'Claim next task' },
  { key: 'k', description: 'Open command palette', modifiers: ['meta'] },
  { key: 'Escape', description: 'Close modal / clear focus' },
];

interface UseKeyboardShortcutsOptions {
  onRefresh?: () => void;
  onClaimNext?: () => void;
  onFocusPanel?: (panel: number) => void;
  onEscape?: () => void;
  enabled?: boolean;
}

export interface UseKeyboardShortcutsResult {
  showHelp: boolean;
  setShowHelp: (show: boolean) => void;
  shortcuts: KeyboardShortcut[];
}

export function useKeyboardShortcuts({
  onRefresh,
  onClaimNext,
  onFocusPanel,
  onEscape,
  enabled = true,
}: UseKeyboardShortcutsOptions): UseKeyboardShortcutsResult {
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in inputs
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      // Allow Escape in inputs
      if (e.key === 'Escape') {
        (target as HTMLInputElement).blur();
      }
      return;
    }

    // Don't trigger if modifier keys are pressed (except for specific shortcuts)
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    switch (e.key) {
      case 'r':
        e.preventDefault();
        onRefresh?.();
        break;

      case '?':
        e.preventDefault();
        setShowHelp(prev => !prev);
        break;

      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        e.preventDefault();
        onFocusPanel?.(parseInt(e.key));
        break;

      case 'n':
        e.preventDefault();
        onClaimNext?.();
        break;

      case 'Escape':
        e.preventDefault();
        setShowHelp(false);
        onEscape?.();
        break;
    }
  }, [onRefresh, onClaimNext, onFocusPanel, onEscape]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);

  return {
    showHelp,
    setShowHelp,
    shortcuts: WHEELHAUS_SHORTCUTS,
  };
}
