import { useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient, defaultApiBase, type ApiClient } from './api/client';
import type { RequestView, Understanding } from './api/contract';
import { fill, screens, SIGN_IN_CODES } from './copy';
import { ConfirmScreen } from './components/ConfirmScreen';
import { FailureScreen } from './components/FailureScreen';
import { FormScreen } from './components/FormScreen';
import { SignInScreen } from './components/SignInScreen';
import { SuccessScreen } from './components/SuccessScreen';
import { WorkingScreen } from './components/WorkingScreen';
import { startPolling, type PollerOptions } from './polling/poller';
import { defaultOperationFromEnv } from './partners/catalog';
import { buildRequestBodyForSubmit, emptyValues, type FormValues } from './request/build';
import { adapterName } from './request/adapter-name';
import { readSessionClaims } from './session/claims';
import { clearToken, getToken, hasUsableToken } from './session/token';
import { HeatmapBrand } from './components/HeatmapBrand';
import { MaterialSymbol } from './icons';
import { helperEnabledForSubmit, type HelperUiState } from './components/MerchantHelper';
import type { HelperNotice } from './components/RequestForm';
import { writeHelperPref } from './model/helper-pref';
import { applyAnswers } from './confirm/apply-answers';
import { parseModelInterpretation, type ModelInterpretation } from './model/interpretation';
import { DEV_MOCK_GOLDENS } from './model/dev-mock-goldens';
import { createModelProvider, type ModelSelect } from './model/select';
import { runMerchantInterpret } from './model/run-merchant-interpret';
import type { ModelProvider } from './model/provider';

type View =
  | { name: 'signin' }
  | { name: 'form' }
  | { name: 'working'; slow: boolean; retrying: boolean; queued: boolean; readingWords: boolean; stage?: 'interpreting' | 'approved'; backupFraction?: number }
  | { name: 'confirm'; requestId: string; understanding: Understanding; interpretation: ModelInterpretation; busy: boolean }
  | { name: 'success'; result: RequestView }
  | { name: 'failed'; code: string; retryAfterSec?: number; detail?: string; offerBackup?: boolean };

/** A first download of the backup helper (about 0.9 GB) can take a long while; the merchant asked for it and can cancel. */
const BACKUP_DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

type DevPreview = 'working' | 'success';

function devPreviewFromLocation(): DevPreview | undefined {
  if (!import.meta.env.DEV || typeof window === 'undefined') return undefined;
  const value = new URLSearchParams(window.location.search).get('uiPreview');
  return value === 'working' || value === 'success' ? value : undefined;
}

const DEV_PREVIEW_RESULT: RequestView = {
  requestId: 'dev-preview-request',
  status: 'succeeded',
  message: 'Your tracking request is ready to test.',
  scriptUrl: 'https://cdn.example.test/heatmap-events.js',
  testTags: ['Clicked Search', 'Scrolled 50 Percent'],
  leftOut: ['Checkout completion is not included in this preview.'],
  updatedAt: '2026-01-01T00:00:00.000Z',
  confirmationDelivery: 'console',
};

export interface AppProps {
  api?: ApiClient;
  supportEmail?: string;
  /** Local Track 2 sign-in page; defaults to VITE_LOCAL_SIGNIN_PAGE. */
  localSignInPage?: string;
  /** Optional Heatmap dashboard hand-off; defaults to VITE_HEATMAP_DASHBOARD_URL. */
  heatmapDashboardUrl?: string;
  /** In-browser helper provider (BM-6). Defaults to `auto` from VITE_MERCHANT_MODEL. */
  modelProvider?: ModelProvider;
  merchantModelMode?: ModelSelect;
  /**
   * True when the server has its own reader for the words (the Claude assistant, manifests/http-local-claude.yaml), so a request may be sent
   * without the helper's reading. Default: VITE_SERVER_READS=1. When false, nothing is sent until the helper has read the words.
   */
  serverReads?: boolean;
  pollOptions?: Pick<PollerOptions, 'delays' | 'maxTotalMs' | 'maxConsecutiveErrors'>;
  /** Wait before we say "this is taking longer". Default 60 seconds. */
  slowAfterMs?: number;
}

export function App(props: AppProps) {
  const devPreview = devPreviewFromLocation();
  const api = useMemo(
    () => props.api ?? createApiClient({ base: defaultApiBase(), getToken }),
    [props.api],
  );
  const supportEmail = props.supportEmail ?? import.meta.env.VITE_SUPPORT_EMAIL?.trim();
  const localSignInPage =
    props.localSignInPage ?? import.meta.env.VITE_LOCAL_SIGNIN_PAGE?.trim() ?? '';
  const heatmapDashboardUrl =
    props.heatmapDashboardUrl ?? import.meta.env.VITE_HEATMAP_DASHBOARD_URL?.trim() ?? '';
  const provider = useMemo(() => {
    if (props.modelProvider) return props.modelProvider;
    const envMode = import.meta.env.VITE_MERCHANT_MODEL as ModelSelect | undefined;
    // The in-browser helper is the default reader. 'mock' (canned answers) and 'none' (no helper) exist only when asked for by name.
    const mode = props.merchantModelMode ?? envMode ?? ('auto' satisfies ModelSelect);
    const goldens = mode === 'mock' ? DEV_MOCK_GOLDENS : undefined;
    return createModelProvider(mode, goldens);
  }, [props.modelProvider, props.merchantModelMode]);
  const serverReads = props.serverReads ?? import.meta.env.VITE_SERVER_READS === '1';
  const [helperNotice, setHelperNotice] = useState<HelperNotice | null>(null);
  const [helperReady, setHelperReady] = useState(false);
  const [helperKey, setHelperKey] = useState(0);
  const skipHelperRef = useRef(false);
  /** The browser helper already read this submission after the server's reader failed: never loop. */
  const helperRetriedRef = useRef(false);
  /** The merchant's click on "Get the backup ready" is being handled. */
  const backupBusyRef = useRef(false);
  /** The server's own sentence for the last reader failure, shown again if the backup also fails or is cancelled. */
  const readerDetailRef = useRef<string | undefined>(undefined);
  const interpretAbortRef = useRef<AbortController | null>(null);
  const session = readSessionClaims();

  const [view, setView] = useState<View>(() => {
    if (devPreview === 'working') return { name: 'working', slow: false, retrying: false, queued: true, readingWords: false };
    if (devPreview === 'success') return { name: 'success', result: DEV_PREVIEW_RESULT };
    return hasUsableToken() ? { name: 'form' } : { name: 'signin' };
  });
  const defaultOp = defaultOperationFromEnv();
  const [values, setValues] = useState<FormValues>(() => emptyValues(defaultOp));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Move focus to the screen title whenever the screen changes.
  useEffect(() => {
    headingRef.current?.focus();
  }, [view.name]);

  useEffect(
    () => () => {
      stopRef.current?.();
      if (slowTimer.current) clearTimeout(slowTimer.current);
    },
    [],
  );

  const fail = (code: string, retryAfterSec?: number, detail?: string) => {
    if (SIGN_IN_CODES.includes(code)) {
      clearToken();
      setView({ name: 'signin' });
      return;
    }
    setView({ name: 'failed', code, retryAfterSec, detail });
  };

  const pollRequest = (id: string, stage?: 'interpreting' | 'approved') => {
    slowTimer.current = setTimeout(
      () => setView((v) => (v.name === 'working' ? { ...v, slow: true } : v)),
      props.slowAfterMs ?? 60_000,
    );
    stopRef.current = startPolling({
      ...props.pollOptions,
      fetchOnce: () => api.getRequest(id),
      onUpdate: (r) =>
        setView((v) =>
          v.name === 'working'
            ? {
                ...v,
                retrying: false,
                queued: r.status === 'queued',
                readingWords: false,
                stage: r.status === 'interpreting' ? 'interpreting' : r.status === 'running' ? undefined : stage,
              }
            : v,
        ),
      onRetrying: () => setView((v) => (v.name === 'working' ? { ...v, retrying: true } : v)),
      onDone: (outcome) => {
        if (slowTimer.current) clearTimeout(slowTimer.current);
        if (outcome.kind === 'terminal') {
          const r = outcome.view;
          if (r.status === 'succeeded') setView({ name: 'success', result: r });
          else if (r.code === 'reader-unavailable' && serverReads && !helperRetriedRef.current) {
            // The server's reader could not read the words: the browser helper (if this browser can run it) reads them and the request is sent again.
            helperRetriedRef.current = true;
            readerDetailRef.current = r.message;
            readWithHelper({ allowDownload: false })
              .then((result) => {
                if (result === 'download-needed') setView({ name: 'failed', code: 'reader-unavailable', detail: r.message, offerBackup: true });
                else if (result === 'no') fail('reader-unavailable', undefined, r.message);
              })
              .catch(() => fail('reader-unavailable', undefined, r.message));
          } else fail(r.code ?? 'command-error', undefined, r.message);
        } else if (outcome.kind === 'needs-confirmation') {
          const r = outcome.view;
          const interpretation = parseModelInterpretation(r.interpretation);
          if (!r.understanding || !interpretation) fail('bad-response');
          else setView({ name: 'confirm', requestId: id, understanding: r.understanding, interpretation, busy: false });
        } else if (outcome.kind === 'timeout') {
          setView((v) => (v.name === 'working' ? { ...v, slow: true } : v));
        } else {
          fail(outcome.error.code, outcome.error.retryAfterSec);
        }
      },
    });
  };

  /**
   * The server's reader failed: read the words in the browser and send the request again. 'download-needed': the helper is not on this
   * browser and the merchant has not asked for the download yet (nothing is ever downloaded without a click). 'no': this browser cannot.
   */
  const readWithHelper = async (opts: { allowDownload: boolean }): Promise<'sent' | 'download-needed' | 'no'> => {
    const caps = await provider.capabilities();
    if (!caps.usable) return 'no';
    const cached = provider.isCached ? await provider.isCached() : caps.cached;
    if (!cached && !opts.allowDownload) return 'download-needed';
    setView({ name: 'working', slow: false, retrying: false, queued: true, readingWords: true, ...(cached ? {} : { backupFraction: 0 }) });
    const pageUrls = values.pageUrls.map((u) => u.trim()).filter(Boolean);
    interpretAbortRef.current = new AbortController();
    let reading = null;
    try {
      reading = await runMerchantInterpret(
        provider,
        values.prompt.trim(),
        pageUrls,
        interpretAbortRef.current.signal,
        cached ? undefined : (p) => setView((v) => (v.name === 'working' ? { ...v, backupFraction: p.fraction } : v)),
        // a first download of about 0.9 GB can take far longer than a normal read
        cached ? undefined : BACKUP_DOWNLOAD_TIMEOUT_MS,
      );
    } finally {
      interpretAbortRef.current = null;
      setView((v) => (v.name === 'working' ? { ...v, readingWords: false, backupFraction: undefined } : v));
    }
    if (!reading) return 'no';
    const created = await api.createRequest(buildRequestBodyForSubmit(values, reading));
    if (!created.ok) {
      fail(created.error.code, created.error.retryAfterSec);
      return 'sent';
    }
    pollRequest(created.data.requestId);
    return 'sent';
  };

  /** The merchant asked for the backup helper: download it, read the words, send the request again. */
  const getBackup = () => {
    if (backupBusyRef.current) return; // a second click while the first is starting must not start a second read
    backupBusyRef.current = true;
    const offerAgain = () => setView({ name: 'failed', code: 'reader-unavailable', detail: readerDetailRef.current, offerBackup: true });
    readWithHelper({ allowDownload: true })
      .then((result) => {
        if (result === 'no') offerAgain();
      })
      .catch(offerAgain)
      .finally(() => {
        backupBusyRef.current = false;
      });
  };

  const submit = async () => {
    const caps = await provider.capabilities();
    const mockSent = values.sendMockInterpretation;
    const helperReady = caps.usable && helperEnabledForSubmit() && !skipHelperRef.current;
    // The helper (a model) is what reads the words. Without it, and without a server-side reader, nothing is sent: the words alone are never turned into tracking.
    if (!mockSent && !helperReady && !serverReads) {
      skipHelperRef.current = false;
      setHelperNotice(!caps.usable ? (provider.providerId === 'none' ? 'off' : 'unavailable') : 'needed');
      return;
    }
    setHelperNotice(null);
    // With a server-side reader the server reads first; the helper only steps in if that reader fails (see readWithHelperAndResend).
    const useHelper = helperReady && !mockSent && !serverReads;
    helperRetriedRef.current = false;
    setView({ name: 'working', slow: false, retrying: false, queued: true, readingWords: useHelper });
    skipHelperRef.current = false;

    let helperInterpretation = null;
    if (useHelper) {
      const pageUrls = values.pageUrls.map((u) => u.trim()).filter(Boolean);
      interpretAbortRef.current = new AbortController();
      try {
        helperInterpretation = await runMerchantInterpret(
          provider,
          values.prompt.trim(),
          pageUrls,
          interpretAbortRef.current.signal,
        );
      } finally {
        interpretAbortRef.current = null;
        setView((v) => (v.name === 'working' ? { ...v, readingWords: false } : v));
      }
      if (!helperInterpretation && !serverReads) {
        // The helper could not read the words (too slow, unusable answer): say so and let the merchant try again. Nothing is built from the words alone.
        setHelperNotice('could-not-read');
        setView({ name: 'form' });
        return;
      }
    }

    const created = await api.createRequest(buildRequestBodyForSubmit(values, helperInterpretation));
    if (!created.ok) {
      fail(created.error.code, created.error.retryAfterSec);
      return;
    }
    pollRequest(created.data.requestId);
  };

  const approve = async (v: Extract<View, { name: 'confirm' }>, answers: Record<string, string>) => {
    setView({ ...v, busy: true });
    const interpretation = applyAnswers(v.interpretation, v.understanding.questions, answers);
    const res = await api.approveRequest(v.requestId, { interpretation });
    if (!res.ok) {
      fail(res.error.code, res.error.retryAfterSec);
      return;
    }
    setView({ name: 'working', slow: false, retrying: false, queued: false, readingWords: false, stage: 'approved' });
    pollRequest(v.requestId, 'approved');
  };

  const downloadHelper = () => {
    writeHelperPref('on');
    setHelperNotice(null);
    setHelperKey((k) => k + 1);
  };

  const backToForm = () => setView({ name: 'form' });
  const startOver = () => {
    setValues(emptyValues(defaultOp));
    setView({ name: 'form' });
  };

  const signOut = () => {
    clearToken();
    setView({ name: 'signin' });
  };

  return (
    <>
      <a className="skip" href="#main">
        {screens.skipLink}
      </a>
      <header className="hm-site-header">
        <div className="hm-site-header__inner">
          <HeatmapBrand />
          {view.name !== 'signin' && (session.siteId || session.email) ? (
            <div className="hm-session-bar" role="group" aria-label="Your session">
              <div className="hm-session-chip">
                <div className="hm-session-chip__details">
                  {session.siteId ? (
                    <p className="hm-session-chip__site">{fill(screens.session.site, { site: session.siteId })}</p>
                  ) : null}
                  {session.email ? (
                    <p className="hm-session-chip__email">{fill(screens.session.email, { email: session.email })}</p>
                  ) : null}
                </div>
              </div>
              <button type="button" className="hm-session-chip__sign-out" onClick={signOut}>
                {screens.session.signOut}
                <MaterialSymbol name="logout" size={16} />
              </button>
            </div>
          ) : null}
        </div>
      </header>
      {devPreview ? <div className="hm-dev-preview-banner" role="status">DEV PREVIEW · no request sent</div> : null}
      <div className="hm-page">
      <main id="main">
        {view.name === 'signin' && (
          <SignInScreen
            headingRef={headingRef}
            localSignInPage={localSignInPage || undefined}
            heatmapDashboardUrl={heatmapDashboardUrl || undefined}
          />
        )}

        {view.name === 'form' && (
          <FormScreen
            headingRef={headingRef}
            values={values}
            onChange={setValues}
            onSubmit={() => void submit()}
            provider={provider}
            helperNotice={helperNotice}
            helperKey={helperKey}
            onDownloadHelper={downloadHelper}
            promptLocked={!serverReads && !helperReady}
            helperStandby={serverReads}
            onHelperState={(st: HelperUiState) => {
              setHelperReady(st.kind === 'ready');
              if (st.kind === 'ready') setHelperNotice((n) => (n === 'needed' ? null : n));
              // Nothing can read the words: say why right away instead of after a typed-out request.
              else if (!serverReads && st.kind === 'hidden') setHelperNotice(provider.providerId === 'none' ? 'off' : 'unavailable');
              else if (!serverReads && st.kind === 'fallback') setHelperNotice('needed');
            }}
            supportEmail={supportEmail}
          />
        )}

        {view.name === 'working' && (
          <WorkingScreen
            headingRef={headingRef}
            slow={view.slow}
            retrying={view.retrying}
            queued={view.queued}
            readingWords={view.readingWords}
            backupFraction={view.backupFraction}
            stage={view.stage}
            supportEmail={supportEmail}
            onSkipHelperRead={() => {
              skipHelperRef.current = true;
              interpretAbortRef.current?.abort();
              provider.cancel();
            }}
          />
        )}

        {view.name === 'confirm' && (
          <ConfirmScreen
            headingRef={headingRef}
            understanding={view.understanding}
            busy={view.busy}
            onApprove={(answers) => void approve(view, answers)}
            onChange={backToForm}
            supportEmail={supportEmail}
          />
        )}

        {view.name === 'success' && (
          <SuccessScreen result={view.result} headingRef={headingRef} onAnother={startOver} supportEmail={supportEmail} />
        )}

        {view.name === 'failed' && (
          <FailureScreen
            headingRef={headingRef}
            code={view.code}
            retryAfterSec={view.retryAfterSec}
            detail={view.detail}
            adapterName={adapterName(values)}
            supportEmail={supportEmail}
            onTryAgain={backToForm}
            onEditDescription={backToForm}
            offerBackup={view.offerBackup}
            onGetBackup={getBackup}
          />
        )}
      </main>
      <footer className="hm-site-footer">
        <p>
          <span>{screens.footer.note}</span>
          <span className="hm-site-footer__sep" aria-hidden="true">
            ·
          </span>
          <a className="hm-site-footer__ask" href={supportEmail ? `mailto:${supportEmail}?subject=${encodeURIComponent(screens.support.subject)}` : '#help'}>
            {screens.support.link}
          </a>
        </p>
      </footer>
      </div>
    </>
  );
}
