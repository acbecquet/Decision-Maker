/**
 * The readable segment a shared link carries after the code: the title lowercased, accents
 * stripped, anything but letters and digits collapsed to single hyphens, cut at 60 characters.
 * The server never reads it; the code alone identifies the event.
 */
export function slugify(title: string): string {
	return title
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60)
		.replace(/-+$/, '');
}
