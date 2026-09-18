import { ProviderError, type ModelProvider } from './contract';
import type { AnonymizeInput, SynthesizeInput } from './prompts';
import { sleep } from './retry';
import type { AnonymizeOutput, SynthesizeOutput } from './schemas';

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

/** Deterministic stage 3: Borda order decides the cards, themes come from point types, cost points are never quoted. */
export function fakeSynthesize(input: SynthesizeInput): SynthesizeOutput {
	const ids = input.options.map((o) => o.id);
	const b = input.tallies.breakdown;
	const order = b
		? [...b.borda]
				.sort((x, y) => y.score - x.score || ids.indexOf(x.optionId) - ids.indexOf(y.optionId))
				.map((s) => s.optionId)
		: ids;
	const best = order[0] ?? ids[0];
	const runnerUp = order[1] ?? best;
	const worst = order[order.length - 1] ?? best;
	const name = (id: string) => label(input, id);
	const points = input.groups.flat();
	const ofType = (type: string) => points.filter((p) => p.type === type);
	const theme = (type: string, title: string, noun: string) => ({
		title,
		summary: `${ofType(type).length} ${noun} came up.`,
		quotePointIds: ofType(type)
			.slice(0, 2)
			.map((p) => p.id)
	});
	const themes = [
		theme('reason', 'Why people lean this way', 'reasons'),
		theme('condition', 'It depends', 'conditions'),
		theme('constraint', 'Hard limits', 'constraints')
	];
	if (ofType('suggestion').length) themes.push(theme('suggestion', 'Other ideas', 'suggestions'));
	const costLine = input.costMattersToSome || b?.cost ? ' Cost matters to part of the group.' : '';
	return {
		best: {
			optionId: best,
			verdict: `${name(best)} is the pick.`,
			rationale: 'It scores highest across the rankings.',
			consensus: b?.condorcetWinner === best ? 'strong' : 'moderate'
		},
		runnerUp: { optionId: runnerUp, rationale: 'The next best score.' },
		worst: { optionId: worst, rationale: 'Ranked lowest overall.' },
		unexpected: ofType('suggestion').length
			? {
					kind: 'suggestion',
					optionId: null,
					title: 'A suggestion from the group',
					rationale: 'Someone proposed an option not on the list.'
				}
			: null,
		themes,
		stillToSettle: ofType('condition').length
			? ['The conditions people attached to their choices.']
			: [],
		summary: `The group leans toward ${name(best)}, with ${name(runnerUp)} as the fallback.${costLine}`
	};
}

/**
 * Deterministic stand-in used by tests and demos. Model ids: fake-fast, fake-slow (300 ms per call),
 * and the unlisted fake-broken, which fails every call so the failure path can be exercised.
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
		return request.payload.stage === 'anonymize'
			? fakeAnonymize(request.payload.input)
			: fakeSynthesize(request.payload.input);
	}
};
