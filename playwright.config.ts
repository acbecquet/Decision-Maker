import { defineConfig } from '@playwright/test';

const port = 4173;

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: false,
	workers: 1,
	timeout: 30_000,
	expect: { timeout: 5_000 },
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: `http://localhost:${port}`,
		browserName: 'chromium',
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure'
	},
	webServer: {
		command: 'node e2e/reset-db.mjs && npm run build && node build',
		port,
		reuseExistingServer: false,
		timeout: 180_000,
		env: {
			PORT: String(port),
			ORIGIN: `http://localhost:${port}`,
			DATABASE_URL: 'e2e/.tmp/e2e.db',
			ALLOW_FAKE_PROVIDER: '1',
			RATE_LIMIT_SCALE: '10',
			NODE_ENV: 'production'
		}
	}
});
