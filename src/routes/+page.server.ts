import type { PageServerLoad } from './$types';

/** Whether the visitor has an account session decides which home they get: the home screen or the create form. */
export const load: PageServerLoad = ({ locals }) => ({ signedIn: locals.accountId !== null });
