import type { PageServerLoad } from './$types';

/** Whether the visitor has an account session decides which home they get: the home screen or the create form. */
export const load: PageServerLoad = ({ locals, setHeaders }) => {
	// The page differs by session, so no cache may keep one visitor's home for another.
	setHeaders({ 'cache-control': 'private, no-store' });
	return { signedIn: locals.accountId !== null };
};
