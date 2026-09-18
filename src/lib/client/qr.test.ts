import { describe, expect, it } from 'vitest';
import { qrSvg } from './qr';

describe('qrSvg', () => {
	it('renders an inline SVG for the link', async () => {
		const svg = await qrSvg('https://decision-maker-cb.fly.dev/e/abcdefghjk');
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg).toContain('viewBox');
		expect(svg).not.toContain('<script');
	});
});
