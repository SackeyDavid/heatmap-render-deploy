import { useState, type RefObject } from 'react';
import type { Understanding } from '../api/contract';
import { fill, screens } from '../copy';
import { unanswered } from '../confirm/apply-answers';
import { usesLocalStackApi } from '../env/local-stack';
import { AlertIcon, ArrowIcon, MaterialSymbol } from '../icons';
import { FlowBanner, FlowFooter, FlowNote, FlowStepper } from './FlowParts';

export interface ConfirmScreenProps {
  headingRef: RefObject<HTMLHeadingElement>;
  understanding: Understanding;
  /** The merchant approved; `answers` maps each question id to the chosen option id. */
  onApprove: (answers: Record<string, string>) => void;
  /** The merchant wants to change their words: back to the form with everything still filled in. */
  onChange: () => void;
  busy?: boolean;
  supportEmail?: string;
}

/** "Here is what we understood": the list of what will be tracked (with the real page control), what will not, and pick-one questions. */
export function ConfirmScreen(props: ConfirmScreenProps) {
  const c = screens.confirm;
  const u = props.understanding;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);

  const approve = () => {
    const open = unanswered(u.questions, answers);
    setMissing(open);
    if (open.length > 0) return;
    props.onApprove(answers);
  };

  return (
    <section className="hm-flow hm-flow--confirm hm-flow--card hm-flow--enter" aria-labelledby="screen-confirm-title">
      <FlowBanner id="screen-confirm-title" icon="check_circle" title={c.title} subtitle={c.intro} headingRef={props.headingRef} />

      <div className="hm-card-body">
        <FlowStepper active={0} mode="review" />

        {u.confidence !== 'high' ? (
          <div className="error-summary hm-error-summary" role="status">
            <span className="hm-error-summary__icon" aria-hidden="true">
              <AlertIcon size={24} />
            </span>
            <div className="hm-error-summary__body">
              <p>{c.unsure}</p>
            </div>
          </div>
        ) : null}

        <div className="hm-confirm-section hm-confirm-section--track">
          <h2>
            <MaterialSymbol name="visibility" size={16} />
            {c.trackHeading}
          </h2>
          {u.tracked.length === 0 ? (
            <p>{c.nothingToTrack}</p>
          ) : (
            <ul className="hm-confirm-list">
              {u.tracked.map((t) => (
                <li key={`${t.index}-${t.event}`}>
                  <span className="hm-confirm-dot" aria-hidden="true" />
                  <div className="hm-confirm-item">
                    <strong>{t.title}</strong>
                    {t.words ? (
                      <div className="hm-confirm-words">
                        <span>{c.youWrote}</span> <q>{t.words}</q>
                      </div>
                    ) : null}
                    {t.control ? <div className="hm-confirm-control">{fill(c.onPage, { control: t.control })}</div> : null}
                    <div className="hm-confirm-name">
                      {c.testName} <code>{t.event}</code>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {u.questions.map((q) => (
          <fieldset key={q.id} className="hm-confirm-question" aria-describedby={missing.includes(q.id) ? `${q.id}-error` : undefined}>
            <legend>{c.questionHeading}</legend>
            <p>{q.prompt}</p>
            {q.options.map((o) => (
              <label key={o.id} className="hm-confirm-option">
                <input
                  type="radio"
                  name={q.id}
                  value={o.id}
                  checked={answers[q.id] === o.id}
                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                />
                <span>{o.label}</span>
              </label>
            ))}
            {missing.includes(q.id) ? (
              <p id={`${q.id}-error`} role="alert" className="field-error">
                {c.pickRequired}
              </p>
            ) : null}
          </fieldset>
        ))}

        {u.notTracked.length > 0 ? (
          <div className="hm-confirm-section">
            <h2>{c.notTrackedHeading}</h2>
            <ul className="hm-confirm-list hm-confirm-list--plain">
              {u.notTracked.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {u.notes.length > 0 ? (
          <div className="hm-confirm-section">
            <h2>{c.notesHeading}</h2>
            <ul className="hm-confirm-list hm-confirm-list--plain">
              {u.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="hm-confirm-actions">
          <button type="button" className="hm-confirm-approve" onClick={approve} disabled={props.busy}>
            {props.busy ? c.sending : c.approve}
            <ArrowIcon size={18} className="hm-icon--trailing" />
          </button>
          <button type="button" className="hm-confirm-change" onClick={props.onChange} disabled={props.busy}>
            {c.change}
          </button>
        </div>

        <FlowNote>{usesLocalStackApi() ? c.waitNoteLocal : c.waitNote}</FlowNote>
      </div>
      <FlowFooter email={props.supportEmail} />
    </section>
  );
}
