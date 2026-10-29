import { useEffect, useRef, useState } from 'react';
import { modelCopy } from '../copy/model';
import { readHelperPref, writeHelperPref } from '../model/helper-pref';
import { watchIdleUnload } from '../model/idle-unload';
import type { ModelProvider } from '../model/provider';
import { AlertIcon, CloseIcon, FlameIcon, MaterialSymbol } from '../icons';

/** The "ready" card hides itself after this long; the helper stays on. */
export const READY_AUTO_HIDE_MS = 60_000;

export type HelperUiState =
  | { kind: 'hidden' }
  | { kind: 'offer' }
  | { kind: 'loading'; percent: number }
  | { kind: 'ready' }
  | { kind: 'fallback'; message: string };

interface Props {
  provider: ModelProvider;
  onStateChange?: (state: HelperUiState) => void;
  /** Skipping is only offered when something else can read the words (the server does); otherwise the merchant would be stuck. */
  canSkip?: boolean;
}

export function MerchantHelper({ provider, onStateChange, canSkip = true }: Props) {
  const [ui, setUi] = useState<HelperUiState>({ kind: 'hidden' });
  const abortRef = useRef<AbortController | null>(null);
  const [readyHidden, setReadyHidden] = useState(false);

  const set = (next: HelperUiState) => {
    setUi(next);
    onStateChange?.(next);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const caps = await provider.capabilities();
      if (cancelled) return;
      if (!caps.usable) {
        set({ kind: 'hidden' });
        return;
      }
      {
        // Start loading as soon as the app opens (no offer step): the request box stays disabled until the helper is ready.
        const ac = new AbortController();
        abortRef.current = ac;
        set({ kind: 'loading', percent: 0 });
        try {
          await provider.ensureReady((p) => {
            if (!cancelled && !ac.signal.aborted) set({ kind: 'loading', percent: Math.round(p.fraction * 100) });
          }, ac.signal);
          if (!cancelled) {
            writeHelperPref('on');
            set({ kind: 'ready' });
          }
        } catch {
          // Say so plainly instead of pretending: typing and submit still work the simple way.
          if (!cancelled && !ac.signal.aborted) set({ kind: 'fallback', message: modelCopy.failed });
        }
        return;
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [provider]);

  useEffect(() => watchIdleUnload(provider), [provider]);

  // The confirmation is only useful for a moment: it hides itself (the helper itself stays on).
  useEffect(() => {
    if (ui.kind !== 'ready') return;
    const t = setTimeout(() => setReadyHidden(true), READY_AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [ui.kind]);

  const startSetup = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    set({ kind: 'loading', percent: 0 });
    try {
      await provider.ensureReady((p) => {
        if (!ac.signal.aborted) {
          set({ kind: 'loading', percent: Math.round(p.fraction * 100) });
        }
      }, ac.signal);
      writeHelperPref('on');
      set({ kind: 'ready' });
    } catch {
      writeHelperPref('off');
      set({ kind: 'fallback', message: modelCopy.failed });
    }
  };

  const skip = () => {
    writeHelperPref('off');
    set({ kind: 'hidden' });
  };

  if (ui.kind === 'hidden') return null;

  if (ui.kind === 'offer') {
    return (
      <div className="helper-panel hm-helper-panel" role="region" aria-label="Optional understanding helper">
        <span className="hm-panel-head__icon" aria-hidden="true">
          <MaterialSymbol name="auto_awesome" size={20} />
        </span>
        <div className="hm-helper-panel__body">
          <p className="hm-helper-panel__copy">{modelCopy.offer}</p>
          <div className="hm-helper-actions">
            <button type="button" className="hm-helper-setup" onClick={() => void startSetup()}>
              {modelCopy.offerSetup}
            </button>
            <button type="button" className="hm-helper-skip" onClick={skip}>
              {modelCopy.offerSkip}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (ui.kind === 'loading') {
    return (
      <div className="status-box hm-status-box" role="status" aria-live="polite">
        <span className="hm-panel-head__icon hm-panel-head__icon--pulse hm-status-box__icon" aria-hidden="true">
          <MaterialSymbol name="auto_awesome" size={20} />
        </span>
        <div className="hm-status-box__body">
          <p>
            {modelCopy.downloading} {ui.percent}%. {modelCopy.downloadingNote}
          </p>
          {canSkip ? (
            <button type="button" className="link" onClick={skip}>
              {modelCopy.downloadingSkip}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (ui.kind === 'ready') {
    if (readyHidden) return null;
    return (
      <div
        className="helper-panel helper-ready hm-helper-panel hm-helper-panel--ready"
        role="status"
        aria-live="polite"
      >
        <span className="hm-panel-head__icon hm-helper-ready__mark" aria-hidden="true">
          <FlameIcon size={18} />
        </span>
        <p className="hm-helper-panel__copy hm-helper-ready__copy">{modelCopy.ready}</p>
        <button
          type="button"
          className="hm-helper-close"
          aria-label={modelCopy.readyClose}
          onClick={() => setReadyHidden(true)}
        >
          <CloseIcon size={16} aria-hidden={true} />
        </button>
      </div>
    );
  }

  return (
    <div className="helper-panel helper-fallback hm-helper-panel" role="status">
      <div className="hm-panel-head">
        <span className="hm-panel-head__icon hm-panel-head__icon--warn" aria-hidden="true">
          <AlertIcon size={20} />
        </span>
        <p className="hm-helper-panel__copy">{ui.message}</p>
      </div>
    </div>
  );
}

/** Whether submit should call the helper (merchant opted in). */
export function helperEnabledForSubmit(): boolean {
  return readHelperPref() === 'on';
}

export function disableHelperForSession(): void {
  writeHelperPref('off');
}
