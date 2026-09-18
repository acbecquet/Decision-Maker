import { describe, expect, it } from 'vitest';
import { getMailer, mailSink, magicLinkMessage, normalizeEmail } from './mail';

describe('mail', () => {
	it('normalizes addresses', () => {
		expect(normalizeEmail('  Charlie@Example.COM ')).toBe('charlie@example.com');
	});

	it('picks the sink only when allowed, and nothing when unconfigured', () => {
		expect(getMailer({})).toBeNull();
		expect(getMailer({ ALLOW_MAIL_SINK: '1' })?.id).toBe('sink');
		expect(getMailer({ RESEND_API_KEY: 're_x' })?.id).toBe('resend');
		expect(getMailer({ RESEND_API_KEY: 're_x', ALLOW_MAIL_SINK: '1' })?.id).toBe('resend');
	});

	it('keeps sink messages in memory, newest first per address', async () => {
		const sink = getMailer({ ALLOW_MAIL_SINK: '1' })!;
		await sink.sendMagicLink('a@b.co', 'https://x.test/signin/callback?token=1');
		await sink.sendMagicLink('a@b.co', 'https://x.test/signin/callback?token=2');
		await sink.sendMagicLink('c@b.co', 'https://x.test/signin/callback?token=3');
		expect(mailSink.latest('a@b.co')?.url).toBe('https://x.test/signin/callback?token=2');
		expect(mailSink.latest('nobody@b.co')).toBeNull();
	});

	it('writes a plain message with the link and the expiry', () => {
		const { subject, text, html } = magicLinkMessage('https://x.test/signin/callback?token=abc');
		expect(subject).toBe('Sign in to DecisionMaker');
		expect(text).toContain('https://x.test/signin/callback?token=abc');
		expect(text).toContain('15 minutes');
		expect(html).toContain('href="https://x.test/signin/callback?token=abc"');
	});
});
