import { expect, test } from '@playwright/test';

test('pages carry a content security policy and a manifest', async ({ request }) => {
	const home = await request.get('/');
	const csp = home.headers()['content-security-policy'] ?? '';
	expect(csp).toContain("default-src 'self'");
	expect(csp).toMatch(/script-src 'self'/);
	expect(csp).toContain("style-src 'self' 'unsafe-inline'");
	expect(csp).toContain("connect-src 'self' https://openrouter.ai");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(await home.text()).toContain('rel="manifest"');
	const manifest = await request.get('/manifest.webmanifest');
	expect(manifest.status()).toBe(200);
	expect((await manifest.json()).display).toBe('standalone');
});
