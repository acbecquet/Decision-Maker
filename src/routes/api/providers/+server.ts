import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listProviders } from '$lib/server/analysis/provider';

export const GET: RequestHandler = () => json({ providers: listProviders() });
