/** Stub partner checks for generic Heatmap custom-event operations (no live HubSpot/Braze APIs). */
export interface PartnerEventChecks {
  sendTestEvents(args: {
    siteId: string;
    partnerDestination: string;
    jobId: string;
    events: string[];
    scriptVersion: string;
  }): Promise<{ eventsSeen: string[]; details: Record<string, unknown> }>;
}
