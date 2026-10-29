import type { RefObject } from 'react';
import { fill, screens } from '../copy';
import { modelCopy } from '../copy/model';
import { usesLocalStackApi } from '../env/local-stack';
import { MaterialSymbol } from '../icons';
import { FlowBanner, FlowFooter, FlowNote, FlowStepper } from './FlowParts';

export interface WorkingScreenProps {
  headingRef: RefObject<HTMLHeadingElement>;
  slow: boolean;
  retrying: boolean;
  queued: boolean;
  readingWords: boolean;
  /** 0 to 1 while the backup helper downloads on this device (after the merchant asked for it). */
  backupFraction?: number;
  /** Server stage: 'interpreting' (reading the request against the page) or 'approved' (just approved, making the code). */
  stage?: 'interpreting' | 'approved';
  supportEmail?: string;
  onSkipHelperRead: () => void;
}

const PROGRESS_STEPS = ['Understand', 'Build', 'Finish'] as const;

function progressIndex(props: WorkingScreenProps): number {
  if (props.readingWords || props.stage === 'interpreting') return 0;
  if (props.stage === 'approved') return 1;
  // Waiting in line or being read: nothing has been understood yet, so Understand is the active step.
  if (props.queued && !props.retrying) return 0;
  return 2;
}

export function WorkingScreen(props: WorkingScreenProps) {
  const active = progressIndex(props);
  const backingUp = props.backupFraction !== undefined;
  const statusText = backingUp
    ? fill(screens.working.backup, { percent: String(Math.round(Math.min(1, Math.max(0, props.backupFraction ?? 0)) * 100)) })
    : props.readingWords
    ? modelCopy.working
    : props.retrying
      ? screens.working.checkingFailed
      : props.stage === 'interpreting'
        ? screens.working.interpreting
        : props.stage === 'approved'
          ? screens.working.approved
          : props.slow
            ? screens.working.slow
            : props.queued
          ? screens.working.queued
          : screens.working.running;

  return (
    <section className="hm-flow hm-flow--working hm-flow--card hm-flow--enter" aria-busy="true" aria-labelledby="screen-working-title">
      <FlowBanner id="screen-working-title" icon="auto_awesome" title={screens.working.title} subtitle={screens.working.subtitle} headingRef={props.headingRef} />

      <div className="hm-card-body">
        <FlowStepper active={active} mode="working" />

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={PROGRESS_STEPS.length - 1}
          aria-valuenow={active}
          aria-label={screens.working.title}
          className="visually-hidden"
        />

        <p className="hm-state-kicker">
          <MaterialSymbol name="shield_with_heart" size={20} fill={1} />
          Your request is safe to leave running
        </p>

        <div role="status" aria-live="polite" className="hm-working-box">
          <span className="hm-working-box__spinner" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor" opacity="0.9" />
            </svg>
          </span>
          <p className="hm-working-box__text">{statusText}</p>
          {props.readingWords ? (
            <button type="button" className="hm-working-box__skip" onClick={props.onSkipHelperRead}>
              {backingUp ? screens.working.backupCancel : modelCopy.downloadingSkip}
              <MaterialSymbol name="chevron_right" size={16} />
            </button>
          ) : null}
        </div>

        <FlowNote>
          {backingUp
            ? screens.working.backupNote
            : usesLocalStackApi()
            ? props.slow
              ? screens.working.slowLocal
              : screens.working.waitLocal
            : props.slow
              ? screens.working.slow
              : screens.working.wait}
        </FlowNote>
      </div>
      <FlowFooter email={props.supportEmail} />
    </section>
  );
}
