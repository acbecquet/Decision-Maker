import type { EventMode, EventState, OptionView, PointType, PresentedTallies } from './types';

export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max';
export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'fake';
export type Consensus = 'strong' | 'moderate' | 'split';

export type ReportQuote = { pointId: string; text: string };
export type ReportTheme = { title: string; summary: string; quotes: ReportQuote[] };
export type ReportUnexpected = {
	kind: 'option' | 'suggestion' | 'compromise';
	optionId: string | null;
	title: string;
	rationale: string;
} | null;

export type Decision = {
	best: { optionId: string; verdict: string; rationale: string; consensus: Consensus };
	runnerUp: { optionId: string; rationale: string };
	worst: { optionId: string; rationale: string };
};

/** The stored report. Self-contained: quote text is embedded so the purge cannot orphan it. */
export type Report = {
	version: 2;
	mode: EventMode;
	/** Null for an opinions-only event, which has no options to decide between. */
	decision: Decision | null;
	unexpected: ReportUnexpected;
	themes: ReportTheme[];
	stillToSettle: string[];
	summary: string;
	provider: ProviderId;
	model: string;
	promptVersion: string;
	generatedAt: string;
};

/** A stored report of any version this code has ever written, or null when it is not one. */
export function upgradeReport(stored: unknown): Report | null {
	if (!stored || typeof stored !== 'object') return null;
	const r = stored as Record<string, unknown>;
	if (r.version === 2) return r as unknown as Report;
	if (r.version === 1) {
		const { best, runnerUp, worst, ...rest } = r as unknown as Decision & Record<string, unknown>;
		return { ...rest, version: 2, mode: 'ranked', decision: { best, runnerUp, worst } } as Report;
	}
	return null;
}

/** What the report endpoint returns to a host (draft or published) or anyone with the link (published). */
export type ReportView = {
	title: string;
	context: string;
	currency: string;
	mode: EventMode;
	state: EventState;
	publishedAt: string | null;
	options: OptionView[];
	tallies: PresentedTallies;
	report: Report;
};

export type AnalysisStatus = {
	status: 'idle' | 'running' | 'succeeded' | 'failed';
	stage: 'anonymize' | 'synthesize' | null;
	done: number;
	total: number;
	error: string | null;
	hasDraft: boolean;
};

export type ProviderInfo = {
	id: ProviderId;
	label: string;
	/** How the host supplies a key: paste only, or connect (OAuth) with paste as fallback, or nothing. */
	auth: 'key' | 'connect' | 'none';
};

/** An anonymized point as the job holds it in memory and stores it. */
export type Point = { id: string; text: string; type: PointType; optionIds: string[] };
