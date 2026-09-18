import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AppError } from '$lib/server/errors';
import { raise } from '$lib/server/http';
import { mailSink } from '$lib/server/mail';

/** The last magic-link mail sent to an address. Exists only on servers that run with the mail sink. */
export const GET: RequestHandler = ({ url }) => {
	try {
		if (process.env.ALLOW_MAIL_SINK !== '1') throw new AppError(404, 'Not found');
		const to = url.searchParams.get('to') ?? '';
		const message = mailSink.latest(to);
		if (!message) throw new AppError(404, 'No mail for that address');
		return json({ to: message.to, url: message.url });
	} catch (e) {
		raise(e);
	}
};
