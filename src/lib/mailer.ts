import { spawn } from "node:child_process";
import crypto from "node:crypto";

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

function shouldSendMail(): boolean {
  if (process.env.NODE_ENV === "production") {
    return true;
  }
  return process.env.SENDMAIL_IN_DEV?.trim().toLowerCase() === "true";
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function extractAddress(value: string): string | null {
  const match = value.match(/<([^<>]+)>/);
  if (match?.[1]) {
    return match[1].trim();
  }
  return value.includes("@") ? value.trim() : null;
}

function describeSendmailSpawnError(error: NodeJS.ErrnoException, sendmailPath: string): Error {
  if (error.code === "ENOENT") {
    return new Error(
      `sendmail ontbreekt op ${sendmailPath}. Installeer een lokale outbound MTA of zet SENDMAIL_PATH naar de sendmail-compatible binary.`
    );
  }

  return error;
}

export async function sendMail({ to, subject, text, html }: SendMailInput): Promise<void> {
  if (!shouldSendMail()) {
    return;
  }

  const from = sanitizeHeaderValue(process.env.MAIL_FROM?.trim() || "Inzet <info@frii.nl>");
  const recipient = sanitizeHeaderValue(to);
  const safeSubject = sanitizeHeaderValue(subject);
  const sendmailPath = process.env.SENDMAIL_PATH?.trim() || "/usr/sbin/sendmail";
  const configuredEnvelopeFrom = process.env.MAIL_ENVELOPE_FROM?.trim();
  const envelopeFrom = configuredEnvelopeFrom || extractAddress(from) || "info@frii.nl";
  const messageIdDomain =
    process.env.MAIL_MESSAGE_ID_DOMAIN?.trim() ||
    extractAddress(envelopeFrom)?.split("@")[1] ||
    "frii.nl";
  const messageId = `<${crypto.randomUUID()}@${messageIdDomain}>`;
  const multipartBoundary = `inzet-${crypto.randomUUID()}`;
  const dateHeader = new Date().toUTCString();

  if (!recipient) {
    throw new Error("recipient is empty");
  }

  const payload = html
    ? [
        `From: ${from}`,
        `To: ${recipient}`,
        `Subject: ${safeSubject}`,
        `Date: ${dateHeader}`,
        `Message-ID: ${messageId}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${multipartBoundary}"`,
        "",
        `--${multipartBoundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        text,
        `--${multipartBoundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
        `--${multipartBoundary}--`
      ].join("\r\n")
    : [
        `From: ${from}`,
        `To: ${recipient}`,
        `Subject: ${safeSubject}`,
        `Date: ${dateHeader}`,
        `Message-ID: ${messageId}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "",
        text
      ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(sendmailPath, ["-i", "-f", envelopeFrom, "--", recipient], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    let stdinError: NodeJS.ErrnoException | null = null;
    let settled = false;

    function settle(error?: Error) {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }

    child.on("error", (error: NodeJS.ErrnoException) => {
      settle(describeSendmailSpawnError(error, sendmailPath));
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      stdinError = error;
    });

    child.on("close", (code) => {
      if (code === 0) {
        settle();
        return;
      }
      const detail = stderr.trim() || stdinError?.message || "unknown error";
      settle(new Error(`sendmail exit code ${code}: ${detail}`));
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}
