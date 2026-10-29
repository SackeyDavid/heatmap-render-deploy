import type { RefObject } from 'react';
import { screens } from '../copy';
import { CheckIcon, ExternalLinkIcon, LinkIcon, ShieldIcon } from '../icons';
import './signin-screen.css';

export interface SignInScreenProps {
  headingRef: RefObject<HTMLHeadingElement>;
  localSignInPage?: string;
  heatmapDashboardUrl?: string;
}

/** No password form — Heatmap or the local stand-in hands off a one-time sign-in. */
export function SignInScreen({ headingRef, localSignInPage, heatmapDashboardUrl }: SignInScreenProps) {
  const s = screens.signIn;
  const local = localSignInPage?.trim();

  return (
    <section className="signin signin-screen" aria-labelledby="signin-heading">
      <div className="signin-screen__hero" aria-hidden="true">
        <span className="signin-screen__hero-icon">
          <ShieldIcon size={22} />
        </span>
      </div>

      <h1 id="signin-heading" tabIndex={-1} ref={headingRef}>
        {s.title}
      </h1>
      <p className="signin-screen__lede">{s.body}</p>

      {heatmapDashboardUrl ? (
        <div className="signin-dashboard-cta">
          <a className="button primary signin-dashboard-cta__link hm-btn-with-icon" href={heatmapDashboardUrl}>
            {s.dashboardLink}
            <ExternalLinkIcon size={16} className="hm-icon--trailing" />
          </a>
          <p className="hint">{s.dashboardHint}</p>
        </div>
      ) : null}

      <ol className="signin-screen__steps">
        <li>
          <span className="signin-screen__step-mark" aria-hidden="true">
            <LinkIcon size={18} />
          </span>
          <span className="signin-screen__step-text">{s.next}</span>
        </li>
        <li>
          <span className="signin-screen__step-mark" aria-hidden="true">
            <CheckIcon size={18} />
          </span>
          <span className="signin-screen__step-text">{s.returnNote}</span>
        </li>
      </ol>

      {local ? (
        <div className="signin-local">
          <div className="signin-local__head">
            <span className="signin-local__icon" aria-hidden="true">
              <ShieldIcon size={20} />
            </span>
            <div>
              <p className="signin-local__badge">{s.localBadge}</p>
              <h2>{s.localTitle}</h2>
            </div>
          </div>
          <p>{s.localBody}</p>
          <a className="button primary signin-local__cta hm-btn-with-icon" href={local}>
            {s.localLink}
            <ExternalLinkIcon size={16} className="hm-icon--trailing" />
          </a>
          <p className="hint">{s.localHint}</p>
        </div>
      ) : null}
    </section>
  );
}
