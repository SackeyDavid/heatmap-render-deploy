import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from 'react';
import { screens } from '../copy';
import { modelCopy } from '../copy/model';
import { MaterialSymbol } from '../icons';
import {
  fetchPredictiveCompletion,
  PREDICTIVE_DEBOUNCE_MS,
  type PredictiveCompletion,
} from '../model/predictive-typing';
import type { ModelProvider } from '../model/provider';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  provider: ModelProvider;
  /** True until something can read the words (the in-browser helper is ready, or the server reads them). */
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

export function PredictivePromptField({
  id,
  value,
  onChange,
  rows = 6,
  provider,
  disabled,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: Props) {
  const hintId = `${id}-predictive-hint`;
  const ghostId = useId();
  const f = screens.form;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const [alternatives, setAlternatives] = useState<PredictiveCompletion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const fetchGenRef = useRef(0);

  const active = alternatives[activeIndex] ?? null;
  const ghostVisible = !disabled && Boolean(active?.tail) && !dismissed;
  const ghostTail = ghostVisible ? active!.tail : '';
  const showLoadingGhost = !disabled && loading && !ghostTail && value.trim().length >= 3 && !dismissed;

  const dismiss = useCallback(() => {
    setDismissed(true);
    abortRef.current?.abort();
    setAlternatives([]);
    setActiveIndex(0);
    setLoading(false);
  }, []);

  const accept = useCallback(
    (completion: PredictiveCompletion) => {
      onChange(completion.full);
      setAlternatives([]);
      setActiveIndex(0);
      setLoading(false);
      setDismissed(false);
    },
    [onChange],
  );

  useEffect(() => {
    setDismissed(false);
    abortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (disabled) {
      // Locked until the helper is ready: no suggestions, so only the "getting ready" hint shows in the box.
      setAlternatives([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const ac = new AbortController();
      abortRef.current = ac;
      const gen = ++fetchGenRef.current;
      void (async () => {
        const next = await fetchPredictiveCompletion(provider, value, ac.signal);
        if (ac.signal.aborted || gen !== fetchGenRef.current) return;
        setAlternatives(next.alternatives);
        setActiveIndex(0);
        setLoading(false);
      })();
    }, PREDICTIVE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [provider, value, disabled]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const syncMirrorScroll = (el: HTMLTextAreaElement) => {
    if (!mirrorRef.current) return;
    mirrorRef.current.scrollTop = el.scrollTop;
    mirrorRef.current.scrollLeft = el.scrollLeft;
  };

  const onScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    syncMirrorScroll(e.currentTarget);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      if (ghostVisible || showLoadingGhost) {
        e.preventDefault();
        dismiss();
      }
      return;
    }
    if (e.key === 'Tab' && ghostVisible && active && !e.shiftKey) {
      e.preventDefault();
      accept(active);
      return;
    }
    if (ghostVisible && alternatives.length > 1) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % alternatives.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + alternatives.length) % alternatives.length);
      }
    }
    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
      setDismissed(false);
    }
  };

  const describedBy = [ariaDescribedBy, hintId, ghostVisible ? ghostId : ''].filter(Boolean).join(' ');

  return (
    <div className="hm-predictive-field">
      <div
        className={`hm-predictive-input-wrap${ariaInvalid ? ' hm-predictive-input-wrap--invalid' : ''}`}
      >
        <div
          ref={mirrorRef}
          className="hm-predictive-mirror"
          aria-hidden="true"
          data-testid="predictive-mirror"
        >
          <span className="hm-predictive-mirror__typed">{value}</span>
          {showLoadingGhost ? (
            <span className="hm-predictive-ghost hm-predictive-ghost--loading"> …</span>
          ) : ghostTail ? (
            <span className="hm-predictive-ghost" id={ghostId} data-testid="predictive-ghost">
              {ghostTail}
            </span>
          ) : null}
        </div>
        <textarea
          ref={textareaRef}
          id={id}
          className="hm-predictive-textarea"
          rows={rows}
          value={value}
          placeholder={disabled ? modelCopy.lockedPlaceholder : "Tell me when someone opens a FAQ."}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          aria-invalid={ariaInvalid}
          aria-describedby={describedBy || undefined}
          autoComplete="off"
          spellCheck={true}
          {...(ghostVisible
            ? {
                'aria-autocomplete': 'inline' as const,
                'aria-controls': ghostId,
                'aria-expanded': true,
              }
            : showLoadingGhost
              ? { 'aria-busy': true as const }
              : {})}
        />
      </div>
      <p className="hint hm-predictive-hint" id={hintId}>
        <MaterialSymbol name="keyboard" size={15} />
        <span>
          {ghostVisible && active?.source === 'model' ? f.predictiveHintHelper : f.predictiveHint}
        </span>
      </p>
    </div>
  );
}
