import { HEATMAP_LOGO_CID, HEATMAP_LOGO_PNG_BASE64 } from "./branded-email-logo.ts";

/** Images the designed email refers to with cid: addresses; pass these as `images` on the Email. */
export const BRANDED_EMAIL_IMAGES: { cid: string; contentType: string; base64: string }[] = [{ cid: HEATMAP_LOGO_CID, contentType: "image/png", base64: HEATMAP_LOGO_PNG_BASE64 }];

/** The Heatmap look for emails: a green header bar with the wordmark, a white card, plain sentences. Table layout and inline styles only, because mail apps ignore most CSS. */
export interface BrandedEmailSection {
  title: string;
  /** One line each; a "name: detail" line shows the name in bold. */
  items: string[];
}

export interface BrandedEmail {
  /** The grey preview line some mail apps show beside the subject. */
  preheader: string;
  heading: string;
  /** Paragraphs under the heading. */
  intro: string[];
  sections?: BrandedEmailSection[];
  /** Small print under the card, for example how to get help. */
  footnote?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONT = "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

function item(line: string): string {
  const at = line.indexOf(": ");
  const text = at > 0 && at < 60 ? `<strong style="color:#004323;">${esc(line.slice(0, at))}</strong>: ${esc(line.slice(at + 2))}` : esc(line);
  return `<tr><td style="padding:6px 0 6px 0;font:15px/1.5 ${FONT};color:#191919;"><span style="color:#10b068;font-weight:700;">&#10003;</span>&nbsp; ${text}</td></tr>`;
}

export function renderBrandedEmail(m: BrandedEmail): string {
  const intro = m.intro.map((p) => `<p style="margin:0 0 14px 0;font:16px/1.55 ${FONT};color:#191919;">${esc(p)}</p>`).join("");
  const sections = (m.sections ?? [])
    .filter((s) => s.items.length > 0)
    .map(
      (s) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px 0;background:#f4f9f6;border-radius:10px;"><tr><td style="padding:14px 18px;">` +
        `<p style="margin:0 0 6px 0;font:700 12px/1.4 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:#0c8f54;">${esc(s.title)}</p>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${s.items.map(item).join("")}</table></td></tr></table>`,
    )
    .join("");
  const foot = m.footnote ? `<p style="margin:0 0 8px 0;font:13px/1.5 ${FONT};color:#5c5c5c;">${esc(m.footnote)}</p>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(m.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f9f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(m.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f9f6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
<tr><td style="background:#004323;border-radius:14px 14px 0 0;padding:18px 24px;">
<img src="cid:${HEATMAP_LOGO_CID}" width="32" height="32" alt="" style="display:inline-block;width:32px;height:32px;vertical-align:middle;border:0;">
<span style="font:600 20px/1 Poppins,${FONT};color:#ffffff;vertical-align:middle;padding-left:10px;">heatmap</span>
</td></tr>
<tr><td style="background:#10b068;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e8e8e8;border-top:0;border-radius:0 0 14px 14px;padding:28px 24px 20px 24px;">
<h1 style="margin:0 0 14px 0;font:600 24px/1.25 Poppins,${FONT};color:#004323;">${esc(m.heading)}</h1>
${intro}${sections}${foot}
</td></tr>
<tr><td style="padding:14px 8px;text-align:center;font:12px/1.5 ${FONT};color:#5c5c5c;">Sent by Heatmap.</td></tr>
</table></td></tr></table></body></html>`;
}
