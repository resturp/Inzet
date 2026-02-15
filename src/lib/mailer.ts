import { spawn } from "node:child_process";
import crypto from "node:crypto";

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
};

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

export async function sendMail({ to, subject, text }: SendMailInput): Promise<void> {
  const from = sanitizeHeaderValue(
    process.env.MAIL_FROM?.trim() || "Inzet VC Zwolle <noreply@vczwolle.frii.nl>"
  );
  const recipient = sanitizeHeaderValue(to);
  const safeSubject = sanitizeHeaderValue(subject);
  const sendmailPath = process.env.SENDMAIL_PATH?.trim() || "/usr/sbin/sendmail";
  const configuredEnvelopeFrom = process.env.MAIL_ENVELOPE_FROM?.trim();
  const envelopeFrom =
    configuredEnvelopeFrom || extractAddress(from) || "noreply@vczwolle.frii.nl";
  const messageIdDomain =
    process.env.MAIL_MESSAGE_ID_DOMAIN?.trim() ||
    extractAddress(envelopeFrom)?.split("@")[1] ||
    "vczwolle.frii.nl";
  const messageId = `<${crypto.randomUUID()}@${messageIdDomain}>`;
  const dateHeader = new Date().toUTCString();

  if (!recipient) {
    throw new Error("recipient is empty");
  }

  const payload = [
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

    child.on("error", reject);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`sendmail exit code ${code}: ${stderr || "unknown error"}`));
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}
