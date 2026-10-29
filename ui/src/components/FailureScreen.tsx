import type { RefObject } from 'react';
import { errorRow, screens } from '../copy';
import { AlertIcon, ArrowIcon } from '../icons';
import { Support } from './Support';

export interface FailureScreenProps {
  headingRef: RefObject<HTMLHeadingElement>;
  code: string;
  retryAfterSec?: number;
  detail?: string;
  supportEmail?: string;
  onTryAgain: () => void;
  /** The server could not read the words and this device has no backup helper yet: offer to get it (the merchant must ask for the download). */
  offerBackup?: boolean;
  onGetBackup?: () => void;
}

/** Codes whose server message is already a complete, plain sentence for the merchant. */
const SPECIFIC_CODES = new Set(['confirm-failed', 'generate-failed', 'invalid-approval', 'reader-unavailable']);

export function FailureScreen(props: FailureScreenProps) {
  const row = errorRow(props.code, props.retryAfterSec);
  // When we know what to tell the merchant ("we could not tell what to track ..."), say that once. The generic lines for the code say
  // nearly the same thing, so they are left out rather than stacked above it.
  const specific = Boolean(props.detail) && SPECIFIC_CODES.has(props.code);

  return (
    <section className="hm-flow hm-flow--failure hm-flow--enter" aria-labelledby="screen-failure-title">
      <header className="hm-flow__hero hm-flow__hero--compact hm-flow__hero--failure">
        <div className="hm-failure-hero">
          <span className="hm-failure-hero__icon" aria-hidden="true">
            <AlertIcon size={22} />
          </span>
          <h1 id="screen-failure-title" tabIndex={-1} ref={props.headingRef}>
            {screens.failure.title}
          </h1>
        </div>
      </header>
      <div className="error-summary hm-error-summary" role="alert">
        <span className="hm-error-summary__icon" aria-hidden="true">
          <AlertIcon size={24} />
        </span>
        <div className="hm-error-summary__body">
          {specific ? (
            <>
              <p className="detail">{props.detail}</p>
              
            </>
          ) : (
            <>
              <p>{row.said}</p>
              <p>{row.next}</p>
              {props.detail ? <p className="detail">{props.detail}</p> : null}
            </>
          )}
        </div>
      </div>
      {specific ? null : (
        <div className="hm-recovery-card">
          <strong>What you can do next</strong>
          <span>Check the request details and try again. If the issue persists, share the reference with support.</span>
        </div>
      )}
      {props.offerBackup && props.onGetBackup ? (
        <div className="hm-backup-offer" role="group" aria-labelledby="backup-offer-intro">
          <p id="backup-offer-intro">{screens.failure.backupIntro}</p>
          <p>{screens.failure.backupSize}</p>
          <button type="button" className="hm-backup-offer__button" onClick={props.onGetBackup}>
            {screens.failure.backupButton}
          </button>
        </div>
      ) : null}
      <div className="field">
        <button type="button" className="primary hm-btn-with-icon" onClick={props.onTryAgain}>
          {screens.failure.tryAgain}
          <ArrowIcon size={18} className="hm-icon--trailing" />
        </button>
      </div>
      <Support email={props.supportEmail} />
    </section>
  );
}
