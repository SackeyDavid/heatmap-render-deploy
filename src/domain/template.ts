/** Strict {{var}} renderer: a missing variable is an error, so no templating is left in a prompt. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Template variable "${name}" was not provided`);
    return value;
  });
}

/** Fences untrusted text so it reads as data, and cannot close its own fence. */
export function fence(tag: string, text: string): string {
  const safe = text.split(`</${tag}>`).join(`<\\/${tag}>`);
  return `<${tag}>\n${safe}\n</${tag}>`;
}
