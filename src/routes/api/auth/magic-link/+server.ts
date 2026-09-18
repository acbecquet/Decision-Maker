import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createMagicLink } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { AppError } from '$lib/server/errors';
import { raise, readJson } from '$lib/server/http';
import { getMailer } from '$lib/server/mail';
import { enforce } from '$lib/server/ratelimit';
import { magicLinkInput } from '$lib/shared/validation';

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	try {
		const mailer = getMailer();
		if (!mailer) throw new AppError(503, 'Sign-in is not set up on this server');
		enforce(`magic:ip:${getClientAddress()}`, 20, 3_600_000);
		const input = await readJson(request, magicLinkInput);
		enforce(`magic:addr:${input.email}`, 5, 3_600_000);
		const { token, email } = createMagicLink(getDb(), input.email);
		const link = new URL('/signin/callback', process.env.ORIGIN ?? url.origin);
		link.searchParams.set('token', token);
		try {
			await mailer.sendMagicLink(email, link.href);
		} catch (e) {
			console.error('magic link mail failed', e instanceof Error ? e.message : e);
			throw new AppError(502, 'Could not send the email, try again');
		}
		return json({ ok: true });
	} catch (e) {
		raise(e);
	}
};
