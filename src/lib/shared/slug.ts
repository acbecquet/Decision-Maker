/** Latin letters that decomposition leaves alone, spelled the way a reader expects in a link. */
const SPELLINGS: Record<string, string> = {
	ß: 'ss',
	æ: 'ae',
	ø: 'o',
	œ: 'oe',
	ð: 'd',
	þ: 'th',
	ł: 'l',
	đ: 'd'
};

/** Segments that already mean something under /e/{code}; a title must never become one of them. */
const RESERVED = new Set(['edit']);

/**
 * The readable segment a shared link carries after the code: the title lowercased, accents
 * stripped, anything but letters and digits collapsed to single hyphens, cut at 60 characters.
 * The server never reads it; the code alone identifies the event.
 */
export function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[ßæøœðþłđ]/g, (c) => SPELLINGS[c])
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60)
		.replace(/-+$/, '');
}

/** The path of an event's shared link: the code, then the title's slug unless it is empty or reserved. */
export function eventPath(code: string, title: string): string {
	const slug = slugify(title);
	return slug && !RESERVED.has(slug) ? `/e/${code}/${slug}` : `/e/${code}`;
}
