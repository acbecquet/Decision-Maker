import type { EventState, OptionView, PointType, PresentedTallies } from './types';

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

/** The stored report. Self-contained: quote text is embedded so the purge cannot orphan it. */
export type Report = {
	version: 1;
	best: { optionId: string; verdict: string; rationale: string; consensus: Consensus };
	runnerUp: { optionId: string; rationale: string };
	worst: { optionId: string; rationale: string };
	unexpected: ReportUnexpected;
	themes: ReportTheme[];
	stillToSettle: string[];
	summary: string;
	provider: ProviderId;
	model: string;
	promptVersion: string;
	generatedAt: string;
};

/** What the report endpoint returns to a host (draft or published) or an approved participant (published). */
export type ReportView = {
	title: string;
	context: string;
	currency: string;
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
