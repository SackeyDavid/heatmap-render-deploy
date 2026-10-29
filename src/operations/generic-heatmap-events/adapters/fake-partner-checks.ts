import type { PartnerEventChecks } from "../ports.ts";

/** Records test events and echoes them back as seen (verify plumbing only). */
export class InMemoryPartnerEventChecks implements PartnerEventChecks {
  readonly sent: { jobId: string; partnerDestination: string; events: string[]; scriptVersion: string }[] = [];

  constructor(private readonly opts: { dropEvents?: string[] } = {}) {}

  async sendTestEvents(args: {
    siteId: string;
    partnerDestination: string;
    jobId: string;
    events: string[];
    scriptVersion: string;
  }) {
    this.sent.push({
      jobId: args.jobId,
      partnerDestination: args.partnerDestination,
      events: args.events,
      scriptVersion: args.scriptVersion,
    });
    const dropped = new Set(this.opts.dropEvents ?? []);
    const profileId = `heatmap-test-${args.jobId}`;
    return {
      eventsSeen: args.events.filter((e) => !dropped.has(e)),
      details: {
        profileId,
        profileUrl: `https://heatmap.local/test-profile/${profileId}`,
        partnerDestination: args.partnerDestination,
      },
    };
  }
}
