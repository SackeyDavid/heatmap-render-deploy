import type { ReactNode, RefObject } from 'react';
import { screens } from '../copy';
import { MaterialSymbol, type MaterialSymbolName } from '../icons';

/** Pieces shared by the "We're working on it" and "Here is what we understood" cards. */

export function FlowBanner(props: { id: string; icon: MaterialSymbolName; title: string; subtitle: string; headingRef: RefObject<HTMLHeadingElement> }) {
  return (
    <header className="hm-banner">
      <span className="hm-banner__icon" aria-hidden="true">
        <MaterialSymbol name={props.icon} size={26} fill={1} />
      </span>
      <div>
        <h1 id={props.id} tabIndex={-1} ref={props.headingRef}>
          {props.title}
        </h1>
        <p>{props.subtitle}</p>
      </div>
    </header>
  );
}

export type StepMode = 'working' | 'review';

/** Three steps; `active` is the index of the current one. Earlier steps are done, later ones wait. */
export function FlowStepper(props: { active: number; mode: StepMode }) {
  const f = screens.flow;
  const icons: MaterialSymbolName[] = ['auto_awesome', 'layers', 'task_alt'];
  return (
    <ol className="hm-stepper" aria-label={f.stepsLabel}>
      {f.steps.map((label, i) => {
        const state = i < props.active ? 'done' : i === props.active ? 'active' : 'upcoming';
        const caption =
          state === 'done'
            ? f.stateDone
            : state === 'active'
              ? props.mode === 'review'
                ? f.stateReview
                : f.stateProgress
              : i === props.active + 1
                ? f.stateUpcoming
                : f.stateQueued;
        const icon: MaterialSymbolName = state === 'done' || (state === 'active' && props.mode === 'review') ? 'check_circle' : icons[i]!;
        return (
          <li key={label} className={`hm-stepper__step hm-stepper__step--${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            {state === 'active' ? <span className="hm-stepper__badge">{props.mode === 'review' ? f.badgeReview : f.badgeActive}</span> : null}
            <span className="hm-stepper__name">
              <MaterialSymbol name={icon} size={18} fill={state === 'upcoming' ? 0 : 1} />
              {label}
            </span>
            <span className="hm-stepper__caption">{caption}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function FlowNote(props: { children: ReactNode }) {
  return (
    <div className="hm-note">
      <MaterialSymbol name="info" size={20} />
      <p>{props.children}</p>
    </div>
  );
}

export function FlowFooter({ email }: { email?: string }) {
  const href = email ? `mailto:${email}?subject=${encodeURIComponent(screens.support.subject)}` : '#help';
  return (
    <footer className="hm-card-foot">
      <p>
        {screens.support.line}{' '}
        <a href={href}>
          {screens.support.link}
          <MaterialSymbol name="open_in_new" size={15} />
        </a>
      </p>
      <p className="hm-card-foot__note">
        <MaterialSymbol name="lock" size={15} />
        {screens.footer.note}
      </p>
    </footer>
  );
}
