import { Resend } from 'resend';
import { MAGIC_LINK_TTL_MS } from './auth';

export type Mailer = {
	readonly id: 'resend' | 'sink';
	sendMagicLink(to: string, url: string): Promise<void>;
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const DEFAULT_FROM = 'DecisionMaker <onboarding@resend.dev>';

export function magicLinkMessage(url: string): { subject: string; text: string; html: string } {
	const minutes = MAGIC_LINK_TTL_MS / 60_000;
	return {
		subject: 'Sign in to DecisionMaker',
		text: `Tap to sign in: ${url}\n\nThe link works once and expires in ${minutes} minutes.`,
		html: `<p><a href="${url}">Sign in to DecisionMaker</a></p><p>The link works once and expires in ${minutes} minutes.</p>`
	};
}

type SinkMessage = { to: string; url: string; at: number };
const messages: SinkMessage[] = [];

/** In-memory mail for tests and demos. Exposed through GET /api/test/mail when ALLOW_MAIL_SINK=1. */
export const mailSink = {
	latest(to: string): SinkMessage | null {
		const address = normalizeEmail(to);
		return [...messages].reverse().find((m) => m.to === address) ?? null;
	},
	clear() {
		messages.length = 0;
	}
};

const sinkMailer: Mailer = {
	id: 'sink',
	async sendMagicLink(to, url) {
		messages.push({ to: normalizeEmail(to), url, at: Date.now() });
	}
};

function resendMailer(apiKey: string, from: string): Mailer {
	const resend = new Resend(apiKey);
	return {
		id: 'resend',
		async sendMagicLink(to, url) {
			const { subject, text, html } = magicLinkMessage(url);
			const { error } = await resend.emails.send({ from, to: [to], subject, text, html });
			if (error) throw new Error(`Resend refused the message: ${error.message}`);
		}
	};
}

/** Resend when a key is configured, the sink when allowed, otherwise null (sign-in unavailable). */
export function getMailer(env: NodeJS.ProcessEnv = process.env): Mailer | null {
	if (env.RESEND_API_KEY) return resendMailer(env.RESEND_API_KEY, env.MAIL_FROM || DEFAULT_FROM);
	if (env.ALLOW_MAIL_SINK === '1') return sinkMailer;
	return null;
}
