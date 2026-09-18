import { createChatProvider } from './chat';
import { ProviderError, preferFirst, type ModelInfo, type ModelProvider } from '../contract';

const BASE_URL = 'https://openrouter.ai/api/v1';
const PREFERRED = [
	'~deepseek/deepseek-pro-latest',
	'~deepseek/deepseek-flash-latest',
	'~anthropic/claude-opus-latest',
	'~anthropic/claude-sonnet-latest',
	'anthropic/claude-opus-5',
	'~openai/gpt-sol-latest',
	'~google/gemini-pro-latest'
];
const CATALOGUE_TTL_MS = 600_000;
const CATALOGUE_TIMEOUT_MS = 30_000;

type CatalogueModel = {
	id: string;
	name: string;
	architecture?: { output_modalities?: string[] };
	supported_parameters?: string[];
};

type Deps = { fetch?: typeof fetch; origin?: string };

export function createOpenRouterProvider(deps: Deps = {}): ModelProvider {
	const fetchImpl = deps.fetch ?? fetch;
	let cache: { at: number; models: CatalogueModel[] } | null = null;
	let pending: Promise<CatalogueModel[]> | null = null;

	/** Fetches the public catalogue fresh, with a timeout. Only a well-formed body is cached. */
	async function fetchCatalogue(key?: string): Promise<CatalogueModel[]> {
		const res = await fetchImpl(`${BASE_URL}/models`, {
			headers: key ? { authorization: `Bearer ${key}` } : {},
			signal: AbortSignal.timeout(CATALOGUE_TIMEOUT_MS)
		});
		if (res.status === 401) throw new ProviderError('OpenRouter rejected the key', false);
		if (!res.ok)
			throw new ProviderError(
				`OpenRouter model list failed with ${res.status}`,
				res.status === 429 || res.status >= 500
			);
		let body: unknown;
		try {
			body = await res.json();
		} catch {
			throw new ProviderError('OpenRouter returned an unusable model list', true);
		}
		const data = (body as { data?: unknown } | null)?.data;
		if (!Array.isArray(data))
			throw new ProviderError('OpenRouter returned an unusable model list', true);
		cache = { at: Date.now(), models: data as CatalogueModel[] };
		return data as CatalogueModel[];
	}

	/**
	 * The public catalogue, cached for ten minutes. A key is sent when available so account-only
	 * models show, bypassing the cache read (a successful fetch still stores its result). Concurrent
	 * callers share one in-flight fetch instead of each starting their own.
	 */
	function catalogue(key?: string): Promise<CatalogueModel[]> {
		if (cache && Date.now() - cache.at < CATALOGUE_TTL_MS && !key) {
			return Promise.resolve(cache.models);
		}
		if (!pending) {
			pending = fetchCatalogue(key).finally(() => {
				pending = null;
			});
		}
		return pending;
	}

	const usable = (m: CatalogueModel) =>
		(m.architecture?.output_modalities ?? ['text']).includes('text') &&
		!m.id.endsWith(':batch') &&
		(m.supported_parameters ?? []).some(
			(p) => p === 'response_format' || p === 'structured_outputs'
		);

	/** A model's catalogue parameters, or undefined (so unknown-model defaults apply) if the catalogue cannot be fetched. */
	const params = async (model: string): Promise<string[] | undefined> => {
		try {
			return (await catalogue()).find((m) => m.id === model)?.supported_parameters;
		} catch {
			return undefined;
		}
	};

	return createChatProvider({
		id: 'openrouter',
		name: 'OpenRouter',
		baseURL: BASE_URL,
		defaultHeaders: {
			'HTTP-Referer': deps.origin ?? process.env.ORIGIN ?? 'https://decision-maker-cb.fly.dev',
			'X-OpenRouter-Title': 'DecisionMaker'
		},
		tokensField: 'max_tokens',
		fetch: deps.fetch,
		async listModels(_client, key) {
			const models: ModelInfo[] = (await catalogue(key))
				.filter(usable)
				.map((m) => ({ id: m.id, label: m.name }))
				.sort((a, b) => a.id.localeCompare(b.id));
			return preferFirst(models, PREFERRED);
		},
		async effortFields(model, effort) {
			const supported = await params(model);
			if (supported && !supported.includes('reasoning')) return {};
			return { reasoning: { effort, exclude: true } };
		},
		async supportsSchema(model) {
			const supported = await params(model);
			return supported ? supported.includes('structured_outputs') : true;
		}
	});
}

export const openrouterProvider = createOpenRouterProvider();
