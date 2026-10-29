import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LIMITS } from '../api/contract';
import { fill, screens } from '../copy';
import { readSessionClaims } from '../session/claims';
import { AlertIcon, MaterialSymbol, MinusIcon } from '../icons';
import type { ModelProvider } from '../model/provider';
import { OPERATION_GENERIC, OPERATION_KLAVIYO, PARTNER_OPTIONS } from '../partners/catalog';
import { addMentionedPages, extractPageUrls, withHttps } from '../request/extract-urls';
import { FIELD_IDS, validate, type FieldError, type FormValues } from '../request/build';
import { MerchantHelper, type HelperUiState } from './MerchantHelper';
import { modelCopy } from '../copy/model';
import { PredictivePromptField } from './PredictivePromptField';

interface Props {
  values: FormValues;
  onChange: (v: FormValues) => void;
  onSubmit: () => void;
  provider: ModelProvider;
  /** Why the last submit stopped: the helper has to read the words first. Shown with a way forward; nothing is built from the words alone. */
  helperNotice?: HelperNotice | null;
  /** Changes when the merchant asks for the helper download from the notice (restarts the helper card). */
  helperKey?: number;
  onDownloadHelper?: () => void;
  onHelperState?: (state: HelperUiState) => void;
  /** Nothing can read the words yet (helper still loading, or unavailable and no server reader): the box stays disabled. */
  promptLocked?: boolean;
  /** A server-side reader is configured: the in-browser helper waits in the background and its panel is not shown. */
  helperStandby?: boolean;
}

/** Pages already handled, kept outside the form so going back to it does not bring a removed page back. */
const handledPages = { current: new Set<string>() };

/** How long after the last key press the pages in the description are picked up. */
export const PAGE_PICKUP_DELAY_MS = 800;

export type HelperNotice = 'needed' | 'unavailable' | 'off' | 'could-not-read';

export function RequestForm({ values, onChange, onSubmit, provider, helperNotice, helperKey, onDownloadHelper, onHelperState, promptLocked, helperStandby }: Props) {
  const [errors, setErrors] = useState<FieldError[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const f = screens.form;
  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => onChange({ ...values, [k]: v });
  // Pages named in the description are added once, a moment after the merchant stops typing (an address half typed is not a page).
  // A page the merchant takes out is not put back.
  const handled = handledPages;
  const [addedPages, setAddedPages] = useState(0);
  useEffect(() => {
    if (values.prompt.trim() === '') handled.current.clear(); // a different person's form must not inherit another's pages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const latest = useRef(values);
  latest.current = values;
  useEffect(() => {
    const timer = setTimeout(() => {
      const now = latest.current;
      if (now.prompt.trim() === '') handled.current.clear(); // a new description starts fresh
      const found = addMentionedPages(now.pageUrls, now.savedHtml, extractPageUrls(now.prompt), handled.current, LIMITS.pages);
      if (found.added.length === 0) return;
      setAddedPages((n) => n + found.added.length);
      setErrors((e) => e.filter((x) => !x.fieldId.startsWith('field-page-'))); // the page error is stale once a page has been added
      onChange({ ...now, pageUrls: found.pageUrls, savedHtml: found.savedHtml });
    }, PAGE_PICKUP_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.prompt]);

  useEffect(() => {
    if (errors.length > 0) summaryRef.current?.focus();
  }, [errors]);
  useEffect(() => {
    if (helperNotice) noticeRef.current?.focus();
  }, [helperNotice]);

  const errFor = (id: string) => errors.find((e) => e.fieldId === id)?.message;
  const describedBy = (id: string, hintId?: string) =>
    [errFor(id) ? `${id}-error` : '', hintId ?? ''].filter(Boolean).join(' ') || undefined;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (found.length === 0) onSubmit();
  };

  const setPage = (i: number, url: string) =>
    onChange({ ...values, pageUrls: values.pageUrls.map((u, j) => (j === i ? url : u)) });
  const setSaved = (i: number, html: string) =>
    onChange({ ...values, savedHtml: values.savedHtml.map((h, j) => (j === i ? html : h)) });
  const addPage = () =>
    onChange({ ...values, pageUrls: [...values.pageUrls, ''], savedHtml: [...values.savedHtml, ''] });
  const removePage = (i: number) =>
    onChange({
      ...values,
      pageUrls: values.pageUrls.filter((_, j) => j !== i),
      savedHtml: values.savedHtml.filter((_, j) => j !== i),
    });

  const fieldError = (id: string) =>
    errFor(id) ? (
      <p className="field-error" id={`${id}-error`}>
        {errFor(id)}
      </p>
    ) : null;

  return (
    <form className="hm-flow-form" onSubmit={handleSubmit} noValidate>
      {errors.length > 0 && (
        <div className="error-summary hm-error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
          <span className="hm-error-summary__icon" aria-hidden="true">
            <AlertIcon size={22} />
          </span>
          <div className="hm-error-summary__body">
            <h2>{f.errorSummaryTitle}</h2>
            <ul>
              {errors.map((e) => (
                <li key={e.fieldId + e.message}>
                  <a
                    href={`#${e.fieldId}`}
                    onClick={(ev) => {
                      ev.preventDefault();
                      document.getElementById(e.fieldId)?.focus();
                    }}
                  >
                    {fill(f.errorSummaryLink, { field: e.label, message: e.message })}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="hm-field-panel">
        <p className="hm-field-panel__title">
          <span className="hm-field-panel__badge" aria-hidden="true">
            <MaterialSymbol name="auto_awesome" size={14} />
          </span>
          <span>Your request</span>
        </p>
        <div className="field">
          <div className="hm-field-label-row">
            <MaterialSymbol name="arrow_back_ios_new" size={18} className="hm-field-label__lead" />
            <label className="hm-field-label" htmlFor={FIELD_IDS.prompt}>
              {f.promptLabel}
            </label>
          </div>
          <p className="hint" id="prompt-hint">
            {f.promptHint}
          </p>
          {fieldError(FIELD_IDS.prompt)}
          <PredictivePromptField
            id={FIELD_IDS.prompt}
            value={values.prompt}
            onChange={(v) => set('prompt', v)}
            provider={provider}
            disabled={promptLocked}
            aria-invalid={errFor(FIELD_IDS.prompt) ? true : undefined}
            aria-describedby={describedBy(FIELD_IDS.prompt, 'prompt-hint')}
          />
        </div>
        <div className="hm-helper-slot">
          {helperStandby ? null : <MerchantHelper key={helperKey ?? 0} provider={provider} onStateChange={onHelperState} canSkip={!promptLocked} />}
          {helperNotice ? (
            <div className="error-summary hm-error-summary hm-helper-needed" role="alert" tabIndex={-1} ref={noticeRef}>
              <span className="hm-error-summary__icon" aria-hidden="true">
                <AlertIcon size={24} />
              </span>
              <div className="hm-error-summary__body">
                <p>
                  {helperNotice === 'needed'
                    ? modelCopy.needed
                    : helperNotice === 'unavailable'
                      ? modelCopy.neededUnavailable
                      : helperNotice === 'off'
                        ? modelCopy.neededOff
                        : modelCopy.couldNotRead}
                </p>
                {helperNotice === 'needed' && onDownloadHelper ? (
                  <button type="button" className="hm-helper-setup" onClick={onDownloadHelper}>
                    {modelCopy.neededDownload}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="hm-field-panel">
        <p className="hm-field-panel__title">
          <span className="hm-field-panel__badge" aria-hidden="true">
            <MaterialSymbol name="description" size={14} />
          </span>
          <span>Pages</span>
        </p>
        <fieldset className="field">
          <legend className="hm-field-legend-with-icon">
            <span className="hm-field-label-row">
              <MaterialSymbol name="link" size={18} className="hm-field-legend-icon" />
              <span>{f.pagesLegend}</span>
            </span>
          </legend>
          {addedPages > 0 ? (
            <p className="hint" role="status">
              {f.pagesAdded}
            </p>
          ) : null}
          {values.pageUrls.map((url, i) => (
            <div className="page-row" key={i}>
              <div className="hm-field-label-row">
                <MaterialSymbol name="article" size={16} />
                <label className="hm-field-label hm-field-label--body" htmlFor={FIELD_IDS.page(i)}>
                  {fill(f.pageLabel, { n: i + 1 })}
                </label>
              </div>
              <p className="hint" id={`page-hint-${i}`}>
                {f.pageHint}
              </p>
              {fieldError(FIELD_IDS.page(i))}
              <div className="inline">
                <input
                  id={FIELD_IDS.page(i)}
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  placeholder={f.pageHint}
                  value={url}
                  onChange={(e) => setPage(i, e.target.value)}
                  onBlur={(e) => setPage(i, withHttps(e.target.value))}
                  aria-invalid={errFor(FIELD_IDS.page(i)) ? true : undefined}
                  aria-describedby={describedBy(FIELD_IDS.page(i), `page-hint-${i}`)}
                />
                {values.pageUrls.length > 1 && (
                  <button type="button" className="secondary" onClick={() => removePage(i)}>
                    <MinusIcon size={16} aria-hidden="true" />
                    {fill(f.removePage, { n: i + 1 })}
                  </button>
                )}
              </div>
            </div>
          ))}
          {values.pageUrls.length < LIMITS.pages && (
            <button type="button" className="hm-add-page" onClick={addPage}>
              <MaterialSymbol name="add" size={18} />
              {f.addPage}
            </button>
          )}
        </fieldset>
      </div>

      <div className="hm-field-panel">
        <p className="hm-field-panel__title">
          <span className="hm-field-panel__badge" aria-hidden="true">
            <MaterialSymbol name="output" size={14} />
          </span>
          <span>{f.partnerLegend}</span>
        </p>
        <fieldset className="field">
          <legend className="visually-hidden">{f.partnerLegend}</legend>
          <p className="hint" id="partner-hint">
            {f.partnerHint}
          </p>
          <div className="hm-radio-grid" role="presentation">
            {PARTNER_OPTIONS.map((opt) => (
              <label
                key={opt.operation}
                className={`hm-radio-row${values.operation === opt.operation ? ' hm-radio-row--selected' : ''}`}
              >
                <input
                  type="radio"
                  name="partner-operation"
                  checked={values.operation === opt.operation}
                  onChange={() =>
                    onChange({
                      ...values,
                      operation: opt.operation,
                    })
                  }
                />
                <span>
                  <strong>{opt.label}</strong>
                  <span className="hint">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {values.operation === OPERATION_KLAVIYO && (
          <div className="field">
            <div className="hm-field-label-row">
              <MaterialSymbol name="key" size={17} />
              <label className="hm-field-label hm-field-label--body" htmlFor={FIELD_IDS.key}>
                {f.keyLabel}
              </label>
            </div>
            <p className="hint" id="key-hint">
              {f.keyHint}
            </p>
            {fieldError(FIELD_IDS.key)}
            <input
              id={FIELD_IDS.key}
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              className="short hm-key-input"
              placeholder="e.g. AB12cd"
              value={values.publicKey}
              onChange={(e) => set('publicKey', e.target.value)}
              aria-invalid={errFor(FIELD_IDS.key) ? true : undefined}
              aria-describedby={describedBy(FIELD_IDS.key, 'key-hint')}
            />
          </div>
        )}

        {values.operation === OPERATION_GENERIC && (
          <div className="field">
            <div className="hm-field-label-row">
              <MaterialSymbol name="key" size={17} />
              <label className="hm-field-label hm-field-label--body" htmlFor={FIELD_IDS.partnerDestination}>
                {f.partnerDestinationLabel}
              </label>
            </div>
            <p className="hint" id="partner-dest-hint">
              {f.partnerDestinationHint} {f.partnerDestinationExample}
            </p>
            {fieldError(FIELD_IDS.partnerDestination)}
            <input
              id={FIELD_IDS.partnerDestination}
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              className="short"
              value={values.partnerDestination}
              onChange={(e) => set('partnerDestination', e.target.value)}
              aria-invalid={errFor(FIELD_IDS.partnerDestination) ? true : undefined}
              aria-describedby={describedBy(FIELD_IDS.partnerDestination, 'partner-dest-hint')}
            />
          </div>
        )}

        <div className="field">
          <div className="hm-field-label-row">
            <MaterialSymbol name="mail" size={17} />
            <label className="hm-field-label hm-field-label--body" htmlFor={FIELD_IDS.email}>
              {f.emailLabel}
            </label>
          </div>
          <p className="hint" id="email-hint">
            {f.emailHint}
          </p>
          {fieldError(FIELD_IDS.email)}
          <input
            id={FIELD_IDS.email}
            type="email"
            autoComplete="email"
            placeholder={readSessionClaims().email ?? 'owner@example.test'}
            value={values.notifyEmail}
            onChange={(e) => set('notifyEmail', e.target.value)}
            aria-invalid={errFor(FIELD_IDS.email) ? true : undefined}
            aria-describedby={describedBy(FIELD_IDS.email, 'email-hint')}
          />
        </div>
      </div>

      <details className="field hm-field-panel hm-more-options">
        <summary>
          <span className="hm-details-summary__lead">
            <MaterialSymbol name="tune" size={18} />
            <span>{f.detailsSummary}</span>
          </span>
          <MaterialSymbol name="expand_more" size={20} className="hm-details-chevron" />
        </summary>
        <div className="hm-more-options__body">
          <aside className="hm-more-options__tip" aria-label={f.detailsIntro}>
            <span className="hm-more-options__tip-icon" aria-hidden="true">
              <MaterialSymbol name="lightbulb" size={18} />
            </span>
            <div className="hm-more-options__tip-copy">
              <p className="hm-more-options__tip-lead">{f.detailsIntro}</p>
              <p className="hm-more-options__tip-steps" id="saved-howto">
                {f.savedHowTo}
              </p>
            </div>
          </aside>

          <div className="hm-more-options__fields">
            {values.pageUrls.map((_, i) => (
              <div className="hm-more-options__field" key={i}>
                <div className="hm-field-label-row">
                  <MaterialSymbol name="html" size={16} />
                  <label className="hm-field-label hm-field-label--body" htmlFor={FIELD_IDS.saved(i)}>
                    {fill(f.savedLabel, { n: i + 1 })}
                  </label>
                </div>
                {fieldError(FIELD_IDS.saved(i))}
                <textarea
                  id={FIELD_IDS.saved(i)}
                  className="hm-more-options__textarea"
                  rows={5}
                  spellCheck={false}
                  value={values.savedHtml[i] ?? ''}
                  onChange={(e) => setSaved(i, e.target.value)}
                  aria-invalid={errFor(FIELD_IDS.saved(i)) ? true : undefined}
                  aria-describedby={
                    [errFor(FIELD_IDS.saved(i)) ? `${FIELD_IDS.saved(i)}-error` : '', 'saved-howto']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                />
              </div>
            ))}
          </div>

          <fieldset className="hm-more-options__local">
            <legend className="hm-more-options__local-legend">
              <span className="hm-field-label-row">
                <MaterialSymbol name="science" size={16} />
                <span>{f.mockInterpretationLegend}</span>
              </span>
            </legend>
            <p className="hint" id="mock-interpretation-hint">
              {f.mockInterpretationHint}
            </p>
            <label className="hm-more-options__check">
              <input
                type="checkbox"
                checked={values.sendMockInterpretation}
                onChange={(e) => set('sendMockInterpretation', e.target.checked)}
                aria-describedby="mock-interpretation-hint"
              />
              <span>{f.mockInterpretationLabel}</span>
            </label>
            {values.sendMockInterpretation ? (
              <div className="hm-more-options__field hm-more-options__field--mock">
                <label className="hm-field-label hm-field-label--body" htmlFor="field-mock-interpretation">
                  {f.mockInterpretationField}
                </label>
                {fieldError(FIELD_IDS.mockInterpretation)}
                <textarea
                  id="field-mock-interpretation"
                  className="hm-more-options__textarea"
                  rows={8}
                  spellCheck={false}
                  value={values.mockInterpretationJson}
                  onChange={(e) => set('mockInterpretationJson', e.target.value)}
                  aria-invalid={errFor(FIELD_IDS.mockInterpretation) ? true : undefined}
                  aria-describedby={describedBy(FIELD_IDS.mockInterpretation, 'mock-interpretation-hint')}
                />
              </div>
            ) : null}
          </fieldset>
        </div>
      </details>

      <div className="hm-form-actions">
        <div className="field">
          <button type="submit" className="primary hm-btn-with-icon">
            {f.submit}
            <MaterialSymbol name="arrow_forward" size={18} className="hm-icon--trailing" />
          </button>
          <p className="hm-form-privacy">
            <MaterialSymbol name="lock" size={16} />
            <span>{screens.footer.note}</span>
          </p>
        </div>
      </div>
    </form>
  );
}
