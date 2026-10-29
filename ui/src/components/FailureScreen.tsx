import { useState, type RefObject } from 'react';
import { errorRow, fill, screens } from '../copy';
import { MaterialSymbol } from '../icons';
import { readSessionClaims } from '../session/claims';

export interface FailureScreenProps {
  headingRef: RefObject<HTMLHeadingElement>;
  code: string;
  retryAfterSec?: number;
  detail?: string;
  /** Display name of the tool the merchant chose ("Klaviyo", "Another tool", ...). Missing: the chip reads "Adapter". */
  adapterName?: string;
  supportEmail?: string;
  onTryAgain: () => void;
  /** Back to the form with the words kept, to change them. Falls back to the try-again action. */
  onEditDescription?: () => void;
  /** The server could not read the words and this device has no backup helper yet: offer to get it (the merchant must ask for the download). */
  offerBackup?: boolean;
  onGetBackup?: () => void;
}

/** Codes whose server message is already a complete, plain sentence for the merchant. */
const SPECIFIC_CODES = new Set(['confirm-failed', 'generate-failed', 'invalid-approval', 'reader-unavailable']);

/** Three steps with the first one marked as stopped (the Stitch failure reference). */
function StoppedSteps() {
  const f = screens.flow;
  return (
    <ol className="hm-failsteps" aria-label={f.stepsLabel}>
      {f.steps.map((label, i) => (
        <li key={label} className={`hm-failsteps__step${i === 0 ? ' hm-failsteps__step--stopped' : ''}`}>
          <span className="hm-failsteps__num" aria-hidden="true">
            {i + 1}
          </span>
          <span>{label}</span>
          {i === 0 ? (
            <>
              <MaterialSymbol name="warning" size={16} fill={1} />
              <span className="visually-hidden">{`, ${screens.failure.stoppedStep}`}</span>
            </>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function formatTime(d: Date): string {
  try {
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
  } catch {
    return d.toISOString();
  }
}

export function FailureScreen(props: FailureScreenProps) {
  const row = errorRow(props.code, props.retryAfterSec);
  // When we know what to tell the merchant ("we could not tell what to track ..."), say that once. The generic lines for the code say
  // nearly the same thing, so they are left out rather than stacked above it.
  const specific = Boolean(props.detail) && SPECIFIC_CODES.has(props.code);
  const [failedAt] = useState(() => new Date());
  const session = readSessionClaims();
  const help = props.supportEmail ? `mailto:${props.supportEmail}?subject=${encodeURIComponent(screens.support.subject)}` : '#help';
  const f = screens.failure;

  return (
    <>
      <section className="hm-pipeline hm-pipeline--failure" aria-label={screens.flow.stepsLabel}>
        <div>
          <div className="hm-pipeline__top">
            <span className="hm-pipeline__chip">{props.adapterName ? fill(f.pipelineChip, { tool: props.adapterName }) : f.pipelineChipUnknown}</span>
            <span className="hm-pipeline__status">
              <span className="hm-pipeline__status-dot" aria-hidden="true" />
              {f.pipelineStatus}
            </span>
          </div>
          <p className="hm-pipeline__name">{f.pipelineTitle}</p>
        </div>
        <StoppedSteps />
      </section>
      <section className="hm-flow hm-flow--failure hm-flow--card hm-flow--enter" aria-labelledby="screen-failure-title">
        <div className="hm-card-body">
          <header className="hm-failure-hero">
            <span className="hm-failure-hero__icon" aria-hidden="true">
              <MaterialSymbol name="warning" size={26} />
            </span>
            <div>
              <h1 id="screen-failure-title" tabIndex={-1} ref={props.headingRef}>
                {f.title}
              </h1>
              <p>{f.heroLine}</p>
            </div>
          </header>
          <div className="error-summary hm-error-summary" role="alert">
            <span className="hm-error-summary__icon" aria-hidden="true">
              <MaterialSymbol name="warning" size={24} />
            </span>
            <div className="hm-error-summary__body">
              {specific ? (
                <p className="detail">{props.detail}</p>
              ) : (
                <>
                  <p>{row.said}</p>
                  <p>{row.next}</p>
                  {props.detail ? <p className="detail">{props.detail}</p> : null}
                </>
              )}
            </div>
            <code className="hm-error-code" aria-label={`${f.codeLabel}: ${props.code}`}>
              {props.code}
            </code>
          </div>
          {specific ? null : (
            <div className="hm-recovery-card">
              <strong>{f.nextTitle}</strong>
              <span>{f.nextLine}</span>
            </div>
          )}
          {props.offerBackup && props.onGetBackup ? (
            <div className="hm-backup-offer" role="group" aria-labelledby="backup-offer-heading">
              <div className="hm-backup-offer__text">
                <p className="hm-backup-offer__title">
                  <MaterialSymbol name="dns" size={18} />
                  <span id="backup-offer-heading">{f.backupHeading}</span>
                </p>
                <p id="backup-offer-intro">
                  {f.backupIntro} {f.backupSize}
                </p>
              </div>
              <button type="button" className="hm-backup-offer__button" aria-describedby="backup-offer-intro" onClick={props.onGetBackup}>
                <MaterialSymbol name="download" size={18} />
                {f.backupButton}
              </button>
            </div>
          ) : null}
          <div className="hm-failure-actions">
            <button type="button" className="primary hm-failure-actions__try" onClick={props.onTryAgain}>
              {f.tryAgain}
              <MaterialSymbol name="arrow_forward" size={20} className="hm-icon--trailing" />
            </button>
            <button type="button" className="hm-failure-actions__edit" onClick={props.onEditDescription ?? props.onTryAgain}>
              {f.editDescription}
            </button>
          </div>
          <p className="hm-failure-help">
            <span>{screens.support.line}</span>
            <a href={help}>
              {screens.support.link}
              <MaterialSymbol name="open_in_new" size={16} />
            </a>
          </p>
        </div>
      </section>
      <details className="hm-diag">
        <summary>
          <span className="hm-diag__lead">
            <MaterialSymbol name="terminal" size={18} />
            {f.diagTitle}
          </span>
          <MaterialSymbol name="expand_more" size={18} className="hm-diag__chevron" />
        </summary>
        <div className="hm-diag__body">
          <dl className="hm-diag__list">
            <dt>{f.diagCode}</dt>
            <dd>
              <code>{props.code}</code>
            </dd>
            {props.retryAfterSec && props.retryAfterSec > 0 ? (
              <>
                <dt>{f.diagRetry}</dt>
                <dd>{fill(f.diagSeconds, { n: props.retryAfterSec })}</dd>
              </>
            ) : null}
            {session.siteId ? (
              <>
                <dt>{f.diagSite}</dt>
                <dd>{session.siteId}</dd>
              </>
            ) : null}
            {session.email ? (
              <>
                <dt>{f.diagEmail}</dt>
                <dd>{session.email}</dd>
              </>
            ) : null}
            <dt>{f.diagTime}</dt>
            <dd>{formatTime(failedAt)}</dd>
          </dl>
          <p className="hm-diag__safe">{f.diagSafe}</p>
        </div>
      </details>
    </>
  );
}
