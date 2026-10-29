import { screens } from '../copy';

export function Support({ email }: { email?: string }) {
  const href = email
    ? `mailto:${email}?subject=${encodeURIComponent(screens.support.subject)}`
    : '#help';
  return (
    <p className="support">
      {screens.support.line}{' '}
      <a href={href}>{screens.support.link}</a>
    </p>
  );
}
