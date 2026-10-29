/**
 * What counts as a plain email address, in one place: the HTTP layer uses it when a request is accepted and the SMTP
 * notifier uses it before it writes the address into a command or header, so an address accepted at the door can be
 * sent to (and one that cannot be sent to is refused at the door). No spaces, quotes, angle brackets, line breaks or
 * non-ASCII letters (SMTPUTF8 is not supported); the apostrophe is allowed.
 */
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const ADDRESS = new RegExp(`^[A-Za-z0-9._%+'-]{1,64}@${LABEL}(?:\\.${LABEL})+$`);

export const isPlainEmailAddress = (value: string): boolean => value.length <= 254 && ADDRESS.test(value);
