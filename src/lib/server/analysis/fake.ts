import { ProviderError, type ModelProvider } from './contract';
import type { AnonymizeInput, SynthesizeInput } from './prompts';
import { ANALYSIS } from '$lib/shared/constants';
import { sleep } from './retry';
import type { AnonymizeOutput, SynthesizeOutput, SynthesizeOutputFreeform } from './schemas';

const COST_WORDS = /afford|budget|expensive|cheap|cost|price|euro|dollar|€|\$|money|pay/i;
const TYPES = ['reason', 'condition', 'constraint'] as const;

const label = (input: { options: { id: string; label: string }[] }, id: string | undefined) =>
	input.options.find((o) => o.id === id)?.label ?? 'the plan';

/** Deterministic stage 1: one point per sentence, money talk becomes a cost point, nothing is echoed. */
export function fakeAnonymize(input: AnonymizeInput): AnonymizeOutput {
	const about = input.ranking[0] ? [input.ranking[0]] : [];
	const favoured = label(input, input.ranking[0]);
	const sentences = input.opinion
		.split(/[.!?]+/)
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 5);
	const points: AnonymizeOutput['points'] = sentences.map((sentence, i) =>
		COST_WORDS.test(sentence)
			? { text: 'One person is on a tight budget.', type: 'cost', optionIds: about }
			: {
					text: `One person gave a ${TYPES[i % 3]} that favours ${favoured}.`,
					type: TYPES[i % 3],
					optionIds: about
				}
	);
	if (input.suggestion.trim()) {
		points.push({
			text: 'One person suggested something not on the list.',
			type: 'suggestion',
			optionIds: []
		});
	}
	return { points };
}

/** Deterministic stage 3: the tallies decide the cards, themes come from point types, cost points are never quoted. */
export function fakeSynthesize(
	input: SynthesizeInput
): SynthesizeOutput | SynthesizeOutputFreeform {
	const ids = input.options.map((o) => o.id);
	const b = input.tallies.breakdown;
	const voted = input.mode === 'single';
	const listed = (x: string, y: string) => ids.indexOf(x) - ids.indexOf(y);
	const order =
		voted && input.voteOrder?.length
			? input.voteOrder
			: !b
				? ids
				: voted
					? [...b.firstChoice]
							.sort((x, y) => y.count - x.count || listed(x.optionId, y.optionId))
							.map((f) => f.optionId)
					: [...b.borda]
							.sort((x, y) => y.score - x.score || listed(x.optionId, y.optionId))
							.map((s) => s.optionId);
	const best = order[0] ?? ids[0];
	const runnerUp = order[1] ?? best;
	const worst = order[order.length - 1] ?? best;
	const name = (id: string) => label(input, id);
	const points = input.groups.flat();
	const ofType = (type: string) => points.filter((p) => p.type === type);
	const theme = (type: string, title: string, noun: string) => ({
		title,
		summary: `${ofType(type).length} ${ofType(type).length === 1 ? noun.slice(0, -1) : noun} came up.`,
		quotePointIds: ofType(type)
			.slice(0, 2)
			.map((p) => p.id)
	});
	const costLine = input.costMattersToSome || b?.cost ? ' Cost matters to part of the group.' : '';
	const themes = [
		['reason', 'Why people lean this way', 'reasons'],
		['condition', 'It depends', 'conditions'],
		['constraint', 'Hard limits', 'constraints'],
		['suggestion', 'Other ideas', 'suggestions']
	]
		.filter(([type]) => ofType(type).length > 0)
		.map(([type, title, noun]) => theme(type, title, noun));
	const cost = {
		title: 'Cost',
		summary: costLine.trim() || 'Nobody flagged cost.',
		quotePointIds: []
	};
	/** An opinions-only event has no options, so its fillers name none. */
	const fillers =
		input.mode === 'freeform'
			? [
					{
						title: 'What came up',
						summary: 'The opinions cluster around a few practical points.',
						quotePointIds: []
					},
					{
						title: 'Where they differ',
						summary: 'Some opinions pull in different directions.',
						quotePointIds: []
					},
					cost
				]
			: [
					{
						title: 'Where the group stands',
						summary: `${name(best)} leads the ranking.`,
						quotePointIds: []
					},
					{
						title: 'The fallback',
						summary: `${name(runnerUp)} is the next best.`,
						quotePointIds: []
					},
					cost
				];
	while (themes.length < 3) themes.push(fillers[themes.length]);
	const unexpected = ofType('suggestion').length
		? {
				kind: 'suggestion' as const,
				optionId: null,
				title: 'A suggestion from the group',
				rationale: 'Someone proposed an option not on the list.'
			}
		: null;
	const stillToSettle = ofType('condition').length
		? ['The conditions people attached to their choices.']
		: [];
	if (input.mode === 'freeform') {
		return {
			unexpected,
			themes,
			stillToSettle,
			summary: `The group's opinions cluster around ${themes[0].title.toLowerCase()}.`
		};
	}
	return {
		best: {
			optionId: best,
			verdict: `${name(best)} is the pick.`,
			rationale: voted ? 'It has the most votes.' : 'It scores highest across the rankings.',
			consensus: b?.condorcetWinner === best ? 'strong' : 'moderate'
		},
		runnerUp: {
			optionId: runnerUp,
			rationale: voted ? 'The next most votes.' : 'The next best score.'
		},
		worst: {
			optionId: worst,
			rationale: voted ? 'It has the fewest votes.' : 'Ranked lowest overall.'
		},
		unexpected,
		themes,
		stillToSettle,
		summary: `The group leans toward ${name(best)}, with ${name(runnerUp)} as the fallback.${costLine}`
	};
}

/**
 * Deterministic stand-in used by tests and demos. Model ids: fake-fast, fake-slow (300 ms per call),
 * and two unlisted ones: fake-broken fails every call so the failure path can be exercised, and
 * fake-stuck waits until the run is aborted or times out, so a run stays "running" for as long as
 * a scenario needs it to.
 */
export const fakeProvider: ModelProvider = {
	id: 'fake',
	async listModels() {
		return [
			{ id: 'fake-fast', label: 'Fake (deterministic)' },
			{ id: 'fake-slow', label: 'Fake (slow)' }
		];
	},
	async completeJson(request) {
		if (request.model === 'fake-broken')
			throw new ProviderError('The fake provider was told to fail', false);
		if (request.model === 'fake-slow') await sleep(300, request.signal);
		if (request.model === 'fake-stuck') {
			await sleep(ANALYSIS.jobTimeoutMs, request.signal);
			throw new ProviderError('The fake provider was told to hang until aborted', false);
		}
		return request.payload.stage === 'anonymize'
			? fakeAnonymize(request.payload.input)
			: fakeSynthesize(request.payload.input);
	}
};
