// Delivery-provider seam. Uptiq is the default (and only, today) provider — routing sends through
// this indirection lets a second SMS/email provider, or a queue-only "no provider connected" mode,
// drop in WITHOUT touching the enqueue helpers or the drain, so Uptiq is a tie-in rather than a
// hard dependency. Behavior with Uptiq is UNCHANGED: the Uptiq provider addresses by the Uptiq
// contact id exactly as the drain did before.
import { uptiq } from "./uptiq.ts";

// How to reach a recipient. `uptiqContactId` is what Uptiq addresses by; `phone`/`email` are here
// so a future non-Uptiq provider has something to send to (the drain can populate them from the
// app contact when such a provider exists). Uptiq ignores phone/email.
export interface Recipient {
  uptiqContactId: string;
  phone?: string | null;
  email?: string | null;
}

export interface DeliveryResult { ok: boolean; status?: number; error?: string; data?: unknown }

export interface MessagingProvider {
  readonly name: string;
  sendSms(to: Recipient, body: string): Promise<DeliveryResult>;
  sendEmail(to: Recipient, subject: string, html: string): Promise<DeliveryResult>;
  applyTag(to: Recipient, tag: string): Promise<DeliveryResult>;
}

// The Uptiq provider — the same Conversations/tag calls the drain used directly before.
const uptiqProvider: MessagingProvider = {
  name: "uptiq",
  sendSms: (to, body) => uptiq.sendSms(to.uptiqContactId, body),
  sendEmail: (to, subject, html) => uptiq.sendEmail(to.uptiqContactId, subject, html),
  applyTag: (to, tag) => uptiq.applyTag(to.uptiqContactId, tag),
};

// The active delivery provider. Swap point for decoupling: return a different MessagingProvider
// (selected by an env var or company setting) to route messaging away from Uptiq, or a stub/
// queue-only provider when nothing is connected. Defaults to Uptiq — unchanged today.
export function activeProvider(): MessagingProvider {
  return uptiqProvider;
}
