import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { findEventByCode } from '$lib/server/events';
import { eventPath } from '$lib/shared/slug';

/**
 * The title alone, for the tab and for the card a messenger renders from the link. Who the
 * visitor is still comes from browser storage on the client, so nothing else is rendered here.
 */
export const load: PageServerLoad = ({ params, url }) => {
	const event = findEventByCode(getDb(), params.code);
	if (!event) return { preview: null };
	return {
		preview: { title: event.title, url: `${url.origin}${eventPath(event.code, event.title)}` }
	};
};
