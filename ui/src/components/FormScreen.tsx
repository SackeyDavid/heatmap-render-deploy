import type { RefObject } from 'react';
import { screens } from '../copy';
import type { ModelProvider } from '../model/provider';
import type { FormValues } from '../request/build';
import { FlameIcon, MaterialSymbol } from '../icons';
import type { HelperUiState } from './MerchantHelper';
import { RequestForm, type HelperNotice } from './RequestForm';
import { Support } from './Support';

export interface FormScreenProps {
  headingRef: RefObject<HTMLHeadingElement>;
  values: FormValues;
  onChange: (v: FormValues) => void;
  onSubmit: () => void;
  provider: ModelProvider;
  helperNotice?: HelperNotice | null;
  helperKey?: number;
  onDownloadHelper?: () => void;
  onHelperState?: (state: HelperUiState) => void;
  promptLocked?: boolean;
  helperStandby?: boolean;
  supportEmail?: string;
}

export function FormScreen(props: FormScreenProps) {
  const f = screens.form;

  return (
    <section className="hm-flow hm-flow--form hm-flow--enter" aria-labelledby="screen-form-title">
      <div className="hm-flow__rail">
        <header className="hm-flow__hero">
          <div className="hm-panel-head hm-panel-head--hero">
            <span className="hm-panel-head__icon hm-icon--brand" aria-hidden="true">
              <FlameIcon size={24} />
            </span>
            <div>
              <h1 id="screen-form-title" tabIndex={-1} ref={props.headingRef}>
                {f.title}
              </h1>
              <p className="hm-flow__lede">{f.intro}</p>
            </div>
          </div>
          <ol className="hm-flow-tease" aria-label="How this works">
            {f.productTease.map((label, i) => (
              <li
                key={label}
                className={`hm-flow-tease__item${i === 0 ? ' hm-flow-tease__item--active' : ''}`}
              >
                <span className="hm-flow-tease__step">
                  <span className="hm-flow-tease__number" aria-hidden="true">
                    {i + 1}
                  </span>
                  <strong className="hm-flow-tease__label">{label}</strong>
                </span>
              </li>
            ))}
          </ol>
          <p className="hm-flow__rail-foot">
            <span className="hm-flow__rail-foot-icon" aria-hidden="true">
              <MaterialSymbol name="verified_user" size={18} />
            </span>
            <span>{f.railFoot}</span>
          </p>
        </header>
        <Support email={props.supportEmail} />
      </div>
      <div className="hm-request-surface">
        <RequestForm
          values={props.values}
          onChange={props.onChange}
          onSubmit={props.onSubmit}
          provider={props.provider}
          helperNotice={props.helperNotice}
          helperKey={props.helperKey}
          onDownloadHelper={props.onDownloadHelper}
          onHelperState={props.onHelperState}
          promptLocked={props.promptLocked}
          helperStandby={props.helperStandby}
        />
      </div>
    </section>
  );
}
