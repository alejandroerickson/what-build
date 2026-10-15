import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMailer } from "../src/app.ts";
import { AcsMailer, acsSender } from "../src/adapters/mail-acs.ts";
import { loadConfig } from "../src/config.ts";

const sdk = vi.hoisted(() => ({
  client: vi.fn(), credential: vi.fn(), beginSend: vi.fn(), pollUntilDone: vi.fn(),
}));
vi.mock("@azure/communication-email", () => ({
  EmailClient: class {
    constructor(...args: unknown[]) { sdk.client(...args); }
    beginSend = sdk.beginSend;
  },
}));
vi.mock("@azure/identity", () => ({
  ManagedIdentityCredential: class {
    constructor(...args: unknown[]) { sdk.credential(...args); }
  },
}));

const endpoint = "https://mail.example.communication.azure.com";
const clientId = "11111111-2222-4333-8444-555555555555";
const message = { to: "person@example.com", subject: "Your WhatBuild sign-in link", text: "A one-use sign-in link." };
const production = { NODE_ENV: "production", WHATBUILD_GRANT_KEY: "k".repeat(32) };
const settings = { ...production, WHATBUILD_MAILER: "acs", WHATBUILD_ACS_EMAIL_ENDPOINT: endpoint, WHATBUILD_MAIL_FROM: "WhatBuild <noreply@example.com>" };

beforeEach(() => {
  vi.clearAllMocks();
  sdk.beginSend.mockResolvedValue({ pollUntilDone: sdk.pollUntilDone });
  sdk.pollUntilDone.mockResolvedValue({ status: "Succeeded" });
});

describe("ACS mail", () => {
  it("sends through the selected managed identity and waits for provider success", async () => {
    const mailer = createMailer(loadConfig({ ...settings, WHATBUILD_AZURE_CLIENT_ID: clientId }));
    expect(mailer).toBeInstanceOf(AcsMailer);
    expect(sdk.client).not.toHaveBeenCalled();
    await mailer.send(message);
    expect(sdk.credential).toHaveBeenCalledWith({ clientId });
    expect(sdk.client).toHaveBeenCalledWith(endpoint, expect.any(Object));
    expect(sdk.beginSend).toHaveBeenCalledWith({
      senderAddress: "noreply@example.com",
      recipients: { to: [{ address: message.to }] },
      content: { subject: message.subject, plainText: message.text },
    }, { abortSignal: expect.any(AbortSignal) });
    const signal = sdk.beginSend.mock.calls[0]![1].abortSignal;
    expect(sdk.pollUntilDone).toHaveBeenCalledWith({ abortSignal: signal });
    await mailer.send(message);
    expect(sdk.client).toHaveBeenCalledTimes(1);
    expect(sdk.credential).toHaveBeenCalledTimes(1);
  });

  it("uses the system-assigned identity when no client ID is set", async () => {
    await createMailer(loadConfig(settings)).send(message);
    expect(sdk.credential).toHaveBeenCalledWith();
  });

  it.each(["Failed", "Canceled", "Running", undefined])("does not report %s as a successful send", async (status) => {
    sdk.pollUntilDone.mockResolvedValue({ status });
    await expect(createMailer(loadConfig(settings)).send(message)).rejects.toThrow(/ACS email send did not succeed/);
  });

  it("does not complete a send while ACS is still processing it", async () => {
    let complete!: (result: { status: string }) => void;
    sdk.pollUntilDone.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const sent = vi.fn();
    const send = createMailer(loadConfig(settings)).send(message).then(sent);
    await vi.waitFor(() => expect(sdk.pollUntilDone).toHaveBeenCalled());
    expect(sent).not.toHaveBeenCalled();
    complete({ status: "Succeeded" });
    await send;
    expect(sent).toHaveBeenCalledOnce();
  });

  it("propagates authentication, submission and polling errors so callers can retry", async () => {
    const error = new Error("Denied by provider");
    sdk.beginSend.mockRejectedValueOnce(error);
    await expect(createMailer(loadConfig(settings)).send(message)).rejects.toBe(error);
    sdk.pollUntilDone.mockRejectedValueOnce(error);
    await expect(createMailer(loadConfig(settings)).send(message)).rejects.toBe(error);
  });

  it("aborts a send that exceeds the time bound", async () => {
    vi.useFakeTimers();
    try {
      sdk.pollUntilDone.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) => new Promise((_resolve, reject) => {
        abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
      }));
      // Node's AbortSignal.timeout uses a native timer; replace only that timer for this test.
      const controller = new AbortController();
      const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        setTimeout(() => controller.abort(new Error("Send timed out")), ms);
        return controller.signal;
      });
      const send = createMailer(loadConfig(settings)).send(message);
      const failure = expect(send).rejects.toThrow("Send timed out");
      await vi.advanceTimersByTimeAsync(60_000);
      await failure;
      expect(timeout).toHaveBeenCalledWith(60_000);
      timeout.mockRestore();
    } finally { vi.useRealTimers(); }
  });
});

describe("ACS configuration", () => {
  it("requires an explicit choice and preserves existing mailer defaults", () => {
    expect(loadConfig({ ...settings, WHATBUILD_MAILER: undefined }).mailer).toBe("none");
    expect(loadConfig({ ...settings, NODE_ENV: "development", WHATBUILD_MAILER: undefined }).mailer).toBe("console");
    expect(loadConfig({ ...settings, WHATBUILD_MAILER: undefined, WHATBUILD_SMTP_URL: "smtp://mail.example:587" }).mailer).toBe("smtp");
    expect(loadConfig({ ...settings, WHATBUILD_MAILER: "none" }).mailer).toBe("none");
  });

  it.each([undefined, "", "http://mail.example", "https://mail.example/path", "https://user:password@mail.example", "https://mail.example?key=value", "https://mail.example#fragment"])("refuses an invalid endpoint (%s)", (value) => {
    expect(() => loadConfig({ ...settings, WHATBUILD_ACS_EMAIL_ENDPOINT: value })).toThrow(/WHATBUILD_ACS_EMAIL_ENDPOINT/);
  });

  it("requires a verified sender to be configured and a valid identity client ID", () => {
    expect(() => loadConfig({ ...settings, WHATBUILD_MAIL_FROM: undefined })).toThrow(/WHATBUILD_MAIL_FROM/);
    expect(() => loadConfig({ ...settings, WHATBUILD_AZURE_CLIENT_ID: "not-a-guid" })).toThrow(/WHATBUILD_AZURE_CLIENT_ID/);
  });

  it("accepts one bare address or one mailbox with a display name", () => {
    expect(acsSender("noreply@example.com")).toBe("noreply@example.com");
    expect(acsSender("WhatBuild <noreply@example.com>")).toBe("noreply@example.com");
    for (const from of ["", "noreply", "a@example.com, b@example.com", "WhatBuild\r\n<noreply@example.com>"])
      expect(() => acsSender(from)).toThrow(/WHATBUILD_MAIL_FROM/);
  });
});
