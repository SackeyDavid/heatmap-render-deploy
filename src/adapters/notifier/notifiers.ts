import type { Email, Notifier } from "../../ports/index.ts";

export class ConsoleNotifier implements Notifier {
  async send(message: Email): Promise<void> {
    console.log(`\n--- email to ${message.to} ---\nSubject: ${message.subject}\n\n${message.body}${message.html ? `\n[a designed HTML version of ${message.html.length} characters is attached]` : ""}\n---`);
  }
}

export class InMemoryNotifier implements Notifier {
  readonly sent: Email[] = [];

  async send(message: Email): Promise<void> {
    this.sent.push(message);
  }
}
