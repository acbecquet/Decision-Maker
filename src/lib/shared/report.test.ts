import { describe, expect, it } from 'vitest';
import { upgradeReport } from './report';

const v1 = {
	version: 1,
	best: { optionId: 'a', verdict: 'A wins', rationale: 'Most first choices', consensus: 'strong' },
	runnerUp: { optionId: 'b', rationale: 'Second' },
	worst: { optionId: 'c', rationale: 'Third' },
	unexpected: null,
	themes: [],
	stillToSettle: [],
	summary: 'Go with A.',
	provider: 'fake',
	model: 'fake-fast',
	promptVersion: 'v1',
	generatedAt: '2026-09-22T00:00:00.000Z'
};

describe('upgradeReport', () => {
	it('lifts a version 1 report into a ranked decision and keeps everything else', () => {
		const report = upgradeReport(v1);
		expect(report).toMatchObject({
			version: 2,
			mode: 'ranked',
			decision: { best: v1.best, runnerUp: v1.runnerUp, worst: v1.worst },
			summary: 'Go with A.',
			promptVersion: 'v1'
		});
		expect(report).not.toHaveProperty('best');
		expect(report).not.toHaveProperty('runnerUp');
		expect(report).not.toHaveProperty('worst');
	});

	it('passes a version 2 report through and rejects anything else', () => {
		const v2 = { ...upgradeReport(v1)!, mode: 'single' as const };
		expect(upgradeReport(v2)).toBe(v2);
		expect(upgradeReport({ version: 3 })).toBeNull();
		expect(upgradeReport(null)).toBeNull();
	});
});
