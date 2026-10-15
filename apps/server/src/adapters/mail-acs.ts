import type { EmailClient } from "@azure/communication-email";
import type { Mailer } from "@whatbuild/core";

/** ACS accepts one bare sender address; keep the same optional display-name form as SMTP. */
export function acsSender(from: string): string {
  const match = /^(?:[^<>\r\n]+<([^<>\r\n]+)>|([^<>\r\n]+))$/.exec(from.trim());
  const address = (match?.[1] ?? match?.[2] ?? "").trim();
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+$/.test(address))
    throw new Error("WHATBUILD_MAIL_FROM must be one sender address for the acs mailer, optionally preceded by a display name.");
  return address;
}

/** Azure-hosted deployments send with their managed identity, without a key or client secret. */
export class AcsMailer implements Mailer {
  private client: Promise<EmailClient> | undefined;
  private readonly sender: string;

  constructor(private readonly endpoint: string, from: string, private readonly clientId: string | null) {
    this.sender = acsSender(from);
  }

  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    this.client ??= Promise.all([import("@azure/communication-email"), import("@azure/identity")])
      .then(([{ EmailClient }, { ManagedIdentityCredential }]) => new EmailClient(
        this.endpoint,
        this.clientId ? new ManagedIdentityCredential({ clientId: this.clientId }) : new ManagedIdentityCredential(),
      ));
    // The API queues a send first. Wait for its terminal result before recording a digest as sent
    // or returning success for a sign-in link or invitation. Bound the whole send, including polls.
    const abortSignal = AbortSignal.timeout(60_000);
    const poller = await (await this.client).beginSend({
      senderAddress: this.sender,
      recipients: { to: [{ address: message.to }] },
      content: { subject: message.subject, plainText: message.text },
    }, { abortSignal });
    const result = await poller.pollUntilDone({ abortSignal });
    if (result.status !== "Succeeded") throw new Error(`ACS email send did not succeed (${result.status}).`);
  }
}
