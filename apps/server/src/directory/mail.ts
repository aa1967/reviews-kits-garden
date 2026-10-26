import nodemailer from 'nodemailer';

export function mailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && (process.env.SMTP_FROM || process.env.SMTP_USER));
}

export async function sendDirectoryMail(to: string, subject: string, text: string): Promise<void> {
  if (!mailConfigured()) throw new Error('Email delivery is not configured. Set SMTP_HOST and SMTP_FROM.');
  const user = process.env.SMTP_USER;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    ...(user ? { auth: { user, pass: process.env.SMTP_PASS } } : {}),
    connectionTimeout: 10000, socketTimeout: 10000,
  });
  try {
    await transport.sendMail({ from: process.env.SMTP_FROM || user, to, subject, text });
  } finally { transport.close(); }
}

export function publicBaseUrl(): string {
  const raw = process.env.BASE_URL || 'http://localhost:5180';
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('BASE_URL must be an HTTP(S) application origin.');
  return url.origin;
}
