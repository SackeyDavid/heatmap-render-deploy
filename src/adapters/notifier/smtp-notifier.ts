import { randomUUID } from "node:crypto";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { isPlainEmailAddress } from "../../domain/email-address.ts";
import type { Email, Notifier } from "../../ports/index.ts";

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  user?: string;
  pass?: string;
  /** When true (default), connect in plain text and upgrade with STARTTLS (port 587). Set false, or use port 465, for implicit TLS. */
  startTls?: boolean;
  /** Extra CA certificate (PEM) to trust, for a server with a private CA. */
  tlsCa?: string;
  /** How long to wait for each server reply. Default 20 s, so an unresponsive server cannot hang a job. */
  timeoutMs?: number;
}

/** The most reply text kept while waiting for the end of a reply. */
const MAX_BUFFER_CHARS = 1_000_000;

/** Sends mail via SMTP (STARTTLS or implicit TLS, optional AUTH LOGIN). Chosen by `bindings.notifier: smtp` in the manifest. */
export class SmtpNotifier implements Notifier {
  constructor(private readonly cfg: SmtpConfig) {}

  async send(message: Email): Promise<void> {
    if (!isPlainEmailAddress(message.to)) throw new Error("SMTP send refused: the recipient address is not a plain email address");
    if (!isPlainEmailAddress(this.cfg.from)) throw new Error("SMTP send refused: the configured sender address is not a plain email address");
    if ((this.cfg.user === undefined) !== (this.cfg.pass === undefined)) throw new Error("SMTP send refused: the username and password must be set together");
    const timeoutMs = this.cfg.timeoutMs ?? 20_000;
    const implicitTls = this.cfg.startTls === false || this.cfg.port === 465;
    const tlsOptions = { servername: this.cfg.host, ...(this.cfg.tlsCa ? { ca: this.cfg.tlsCa } : {}) };

    let socket: Socket | TLSSocket = implicitTls
      ? tlsConnect({ host: this.cfg.host, port: this.cfg.port, ...tlsOptions })
      : netConnect({ host: this.cfg.host, port: this.cfg.port });
    let session = new Session(socket, timeoutMs);
    try {
      await session.expect(null, [220]); // greeting
      await session.expect("EHLO heatmap-agentic.local", [250]);
      if (!implicitTls) {
        await session.expect("STARTTLS", [220]);
        session.detach();
        socket = tlsConnect({ socket, ...tlsOptions }); // there is no new greeting after the upgrade: go straight to EHLO
        session = new Session(socket, timeoutMs);
        await session.expect("EHLO heatmap-agentic.local", [250]);
      }
      if (this.cfg.user && this.cfg.pass) {
        await session.expect("AUTH LOGIN", [334]);
        await session.expect(Buffer.from(this.cfg.user, "utf8").toString("base64"), [334]);
        await session.expect(Buffer.from(this.cfg.pass, "utf8").toString("base64"), [235], "authentication");
      }
      await session.expect(`MAIL FROM:<${this.cfg.from}>`, [250]);
      await session.expect(`RCPT TO:<${message.to}>`, [250, 251]);
      await session.expect("DATA", [354]);
      await session.expect(this.render(message) + "\r\n.", [250]);
      await session.expect("QUIT", [221]).catch(() => undefined); // the message is already accepted
    } finally {
      session.detach();
      socket.destroy();
    }
  }

  /** The message with CRLF line ends. Header values cannot carry line breaks (no header injection); the body is base64 so any text and any leading dot is safe. */
  private render(m: Email): string {
    const header = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v.replace(/[\r\n]+/g, " ") : `=?UTF-8?B?${Buffer.from(v.replace(/[\r\n]+/g, " "), "utf8").toString("base64")}?=`);
    const body = Buffer.from(m.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
    return [
      `From: ${this.cfg.from}`,
      `To: ${m.to}`,
      `Subject: ${header(m.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@heatmap-agentic.local>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
    ].join("\r\n");
  }
}

/**
 * One SMTP conversation. Replies are read as the protocol defines them (one or more lines; "250-" continues, "250 " ends),
 * whatever way the bytes arrive, and bytes after a reply are kept for the next one.
 */
class Session {
  private buffer = "";
  private waiting: { resolve: (r: Reply) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | undefined;
  private failure: Error | undefined;
  private readonly onData = (chunk: Buffer) => {
    this.buffer += chunk.toString("utf8");
    if (this.buffer.length > MAX_BUFFER_CHARS) return this.fail(new Error("SMTP server sent too much data"));
    this.flush();
  };
  private readonly onError = (e: Error) => this.fail(e);
  private readonly onClose = () => this.fail(new Error("SMTP connection closed unexpectedly"));

  constructor(
    private readonly socket: Socket | TLSSocket,
    private readonly timeoutMs: number,
  ) {
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  detach(): void {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
    if (this.waiting) clearTimeout(this.waiting.timer);
  }

  /** Sends `command` (if any) and requires a reply whose code is in `codes`. Errors never include the command (it can carry credentials). */
  async expect(command: string | null, codes: number[], what = "command"): Promise<Reply> {
    if (command !== null) this.socket.write(`${command}\r\n`);
    const reply = await this.read();
    if (!codes.includes(reply.code)) {
      throw new Error(`SMTP ${command === null ? "greeting" : what} failed: ${reply.code} ${reply.text.slice(0, 120)}`);
    }
    return reply;
  }

  private read(): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      const timer = setTimeout(() => this.fail(new Error("SMTP server did not answer in time")), this.timeoutMs);
      this.waiting = { resolve, reject, timer };
      this.flush();
    });
  }

  private flush(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split(/\r?\n/); // a bare LF ends a line too: some servers and proxies send it
    // A reply is complete at the first line shaped "NNN <text>" (space after the code); everything before it belongs to it.
    const end = lines.findIndex((l, i) => i < lines.length - 1 && /^\d{3}( |$)/.test(l));
    if (end < 0) return;
    const reply = lines.slice(0, end + 1);
    this.buffer = lines.slice(end + 1).join("\n");
    const { resolve, timer } = this.waiting;
    this.waiting = undefined;
    clearTimeout(timer);
    resolve({ code: Number(reply[end]!.slice(0, 3)), text: reply.map((l) => l.slice(4)).join(" ").trim() });
  }

  private fail(e: Error): void {
    this.failure ??= e;
    if (this.waiting) {
      const { reject, timer } = this.waiting;
      this.waiting = undefined;
      clearTimeout(timer);
      reject(e);
    }
  }
}

interface Reply {
  code: number;
  text: string;
}
