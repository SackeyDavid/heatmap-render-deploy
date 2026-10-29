// Sends ONE real test copy of the "tracking code is ready" email, built by the same code the app uses, so the design can be seen in an inbox.
//   SMTP_HOST=... SMTP_FROM=... [SMTP_PORT=587] [SMTP_USER=... SMTP_PASS=...] node --import tsx tools/local/send-test-email.ts you@example.com
// Add DRY_RUN=1 to print the message instead of sending it. The values in the email are sample values, marked as a test in the subject.
import { SmtpNotifier } from "../../src/adapters/notifier/smtp-notifier.ts";
import { successEmail } from "../../src/operations/klaviyo-segmentation/operation.ts";

const to = process.argv[2] ?? "";
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error("Usage: node --import tsx tools/local/send-test-email.ts you@example.com");
  process.exit(1);
}

const input = { pages: ["https://manduu.com/"], notifyEmail: to, publicKey: "AB12cd", description: "Test email", pinnedEventNames: [], selectors: [], platform: "custom" } as never;
const job = {
  id: "test",
  operation: "klaviyo.segmentation-script",
  status: "succeeded",
  completedSteps: [],
  state: {
    snapshots: [],
    repairRounds: 0,
    published: { version: "c863af4791b4", sha256: "x", key: "k", url: "https://s3.us-east-005.backblazeb2.com/heatmap-test-files-zq7m/sites/kenn-test/klaviyo/c863af4791b4/script.js", contextVersion: "c" },
    verification: { ok: true, details: { profileUrl: "https://www.klaviyo.com/profile/EXAMPLE" } },
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as never;
const events = JSON.stringify({
  events: [
    { name: "Clicked Our Team", trigger: "a visitor clicks Our Team" },
    { name: "Scrolled 50 Percent", trigger: "a visitor scrolls halfway down the page" },
    { name: "Scrolled 100 Percent", trigger: "a visitor reaches the bottom of the page" },
  ],
  segments: [],
});

const mail = { ...successEmail(input, job, events), subject: `[Test] ${successEmail(input, job, events).subject}` };
if (process.env.DRY_RUN === "1") {
  console.log(`To: ${mail.to}\nSubject: ${mail.subject}\nHTML: ${mail.html?.length} characters, images: ${mail.images?.length}\n\n${mail.body}`);
  process.exit(0);
}
const host = process.env.SMTP_HOST;
const from = process.env.SMTP_FROM;
if (!host || !from) {
  console.error("Set SMTP_HOST and SMTP_FROM (and SMTP_USER and SMTP_PASS if the server needs a login).");
  process.exit(1);
}
await new SmtpNotifier({
  host,
  from,
  port: Number(process.env.SMTP_PORT ?? 587),
  ...(process.env.SMTP_USER ? { user: process.env.SMTP_USER } : {}),
  ...(process.env.SMTP_PASS ? { pass: process.env.SMTP_PASS } : {}),
  ...(process.env.SMTP_STARTTLS === "0" ? { startTls: false } : {}),
}).send(mail);
console.log(`Sent a test email to ${to}. Check the inbox (and the spam folder).`);
