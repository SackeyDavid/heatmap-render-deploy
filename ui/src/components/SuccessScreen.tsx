import { useRef, useState, type RefObject } from 'react';
import type { RequestView } from '../api/contract';
import { screens, tagParts } from '../copy';
import { MaterialSymbol } from '../icons';
import { EmptyStateNote } from './EmptyStateNote';

export interface SuccessScreenProps {
  result: RequestView;
  headingRef: RefObject<HTMLHeadingElement>;
  onAnother: () => void;
  supportEmail?: string;
}

/** `<script src="ADDRESS" async></script>` for an http(s) address; null for anything else. Quotes, angle brackets and ampersands are escaped. */
export function snippetFor(address: string | undefined): string | null {
  if (!address) return null;
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const escaped = address
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<script src="${escaped}" async></script>`;
}

export function SuccessScreen(props: SuccessScreenProps) {
  const { result } = props;
  const supportHref = props.supportEmail ? `mailto:${props.supportEmail}?subject=${encodeURIComponent(screens.support.subject)}` : '#help';
  const s = screens.success;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const snippetRef = useRef<HTMLTextAreaElement>(null);
  const [snippetState, setSnippetState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const snippet = snippetFor(result.scriptUrl);

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet ?? '');
      setSnippetState('copied');
    } catch {
      snippetRef.current?.select();
      setSnippetState('failed');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.scriptUrl ?? '');
      setCopyState('copied');
    } catch {
      inputRef.current?.select();
      setCopyState('failed');
    }
  };

  return (
    <>
      <section className="hm-pipeline" aria-label={screens.flow.stepsLabel}>
        <div>
          <span className="hm-pipeline__tag">{s.pipelineTag}</span>
          <h2>{s.pipelineTitle}</h2>
        </div>
        <ol className="hm-pipeline__steps">
          {screens.flow.steps.map((label, i) => {
            const last = i === screens.flow.steps.length - 1;
            return (
              <li key={label} className={last ? 'hm-pipeline__step hm-pipeline__step--last' : 'hm-pipeline__step'}>
                <span className="hm-pipeline__dot" aria-hidden="true">
                  <MaterialSymbol name="check" size={15} fill={1} />
                </span>
                <span className="hm-pipeline__label">
                  {i + 1}. {label}
                  {last ? <span className="hm-pipeline__ready">{s.pipelineReady}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="hm-flow hm-flow--success hm-flow--enter" aria-labelledby="screen-success-title">
        <div className="hm-hero-card">
          <div className="hm-hero-card__title">
            <span className="hm-hero-card__icon" aria-hidden="true">
              <MaterialSymbol name="check" size={26} fill={1} />
            </span>
            <h1 id="screen-success-title" tabIndex={-1} ref={props.headingRef}>
              {s.title}
            </h1>
          </div>
          <p>{result.message}</p>
          <p className="hm-hero-card__next">{s.nextStep}</p>
        </div>

        <div className="hm-step-banner">
          <span className="hm-step-banner__number">1</span>
          <div>
            <h2>{s.addTitle}</h2>
            <p>{s.addText}</p>
          </div>
        </div>

        {result.scriptUrl ? (
          <div className="hm-code-card">
            <div className="hm-code-card__header">
              <label htmlFor="code-address">{s.codeHeading}</label>
            </div>
            <p className="hint" id="code-address-hint">
              {s.codeHint}
            </p>
            <div className="hm-code-card__row">
              <input
                id="code-address"
                ref={inputRef}
                readOnly
                className="hm-code-card__url"
                value={result.scriptUrl}
                aria-describedby="code-address-hint"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className={['primary', 'hm-code-card__copy', 'hm-btn-with-icon', copyState === 'copied' ? 'hm-code-card__copy--copied' : ''].filter(Boolean).join(' ')}
                onClick={() => void copy()}
              >
                <MaterialSymbol name={copyState === 'copied' ? 'check' : 'content_copy'} size={18} />
                {s.copy}
              </button>
            </div>
            <p role="status" aria-live="polite" className="copy-status">
              {copyState === 'copied' ? s.copied : copyState === 'failed' ? s.copyFailed : ''}
            </p>
          </div>
        ) : null}

        {snippet ? (
          <div className="hm-code-card hm-snippet-card" data-testid="snippet-card">
            <div className="hm-code-card__header">
              <label htmlFor="code-snippet">{s.snippetHeading}</label>
            </div>
            <p className="hint" id="code-snippet-hint">
              {s.snippetWhere} {s.snippetAfter} {s.snippetNeeds}
            </p>
            <div className="hm-snippet-box">
              <div className="hm-snippet-box__bar">
                <span>
                  <i aria-hidden="true" />
                  {s.snippetBar}
                </span>
                <span>{s.snippetBarNote}</span>
              </div>
              <textarea
                id="code-snippet"
                ref={snippetRef}
                readOnly
                rows={2}
                className="hm-snippet-card__text"
                value={snippet}
                aria-label={s.snippetLabel}
                aria-describedby="code-snippet-hint"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
            <div className="hm-snippet-foot">
              <p>
                <MaterialSymbol name="verified" size={18} />
                {s.snippetNote}
              </p>
              <button
                type="button"
                className={['hm-code-card__copy', 'hm-btn-with-icon', snippetState === 'copied' ? 'hm-code-card__copy--copied' : ''].filter(Boolean).join(' ')}
                onClick={() => void copySnippet()}
              >
                <MaterialSymbol name={snippetState === 'copied' ? 'check' : 'code'} size={18} />
                {s.snippetCopy}
              </button>
            </div>
            <p role="status" aria-live="polite" className="copy-status">
              {snippetState === 'copied' ? s.copied : snippetState === 'failed' ? s.snippetCopyFailed : ''}
            </p>
          </div>
        ) : null}

        <div className="hm-test-panel hm-test-panel--primary">
          <div className="hm-test-panel__head">
            <span className="hm-step-banner__number">2</span>
            <div>
              <h2>{s.testHeading}</h2>
              <p>{result.testTags && result.testTags.length > 0 ? s.testIntro : s.testSubtitle}</p>
            </div>
            {result.testTags && result.testTags.length > 0 ? <span className="hm-test-panel__pill">{s.testReady}</span> : null}
          </div>
          {result.testTags && result.testTags.length > 0 ? (
            <ul>
              {result.testTags.map((t) => {
                const { label, exact } = tagParts(t);
                return (
                  <li key={t} className="hm-test-tag">
                    <span className="hm-test-tag__icon" aria-hidden="true">
                      <MaterialSymbol name="touch_app" size={20} />
                    </span>
                    <span className="hm-test-tag__body">
                      <span className="hm-test-tag__label">{label}</span>
                      <span className="hm-test-tag__line">
                        <span className="hm-test-tag__exact">{s.testExactName}</span> <code>{exact}</code>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyStateNote>{s.testNone}</EmptyStateNote>
          )}
        </div>

        {result.leftOut && result.leftOut.length > 0 ? (
          <div className="hm-test-panel hm-left-out">
            <h2>{s.leftHeading}</h2>
            <p>{s.leftIntro}</p>
            <ul>
              {result.leftOut.slice(0, 8).map((item, i) => (
                <li key={`${i}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="hm-success-sent">{props.result.confirmationDelivery === 'console' ? s.emailedLocal : s.emailed}</p>

        <div className="hm-success-footer">
          <p className="hm-success-help">
            <MaterialSymbol name="help_outline" size={20} />
            {screens.support.line} <a href={supportHref}>{screens.support.link}</a>
          </p>
          <button type="button" className="hm-success-another" onClick={props.onAnother}>
            {s.another}
            <MaterialSymbol name="arrow_forward" size={18} />
          </button>
        </div>
      </section>
    </>
  );
}
