import { createChatProvider } from './chat';
import { preferFirst, type ModelInfo, type ModelProvider } from '../contract';

const PREFERRED = ['gpt-5.6', 'gpt-5.6-sol', 'gpt-6-astra'];
/** Model ids that are not chat models. */
const NOT_CHAT =
	/embedding|audio|realtime|tts|transcri|whisper|image|dall-e|moderation|search|instruct|babbage|davinci|computer-use|codex|sora/i;

export function createOpenAiProvider(deps: { fetch?: typeof fetch } = {}): ModelProvider {
	return createChatProvider({
		id: 'openai',
		name: 'OpenAI',
		tokensField: 'max_completion_tokens',
		fetch: deps.fetch,
		async listModels(client) {
			const models: ModelInfo[] = [];
			for await (const m of client.models.list()) {
				if (m.id.startsWith('gpt-') && !NOT_CHAT.test(m.id)) models.push({ id: m.id, label: m.id });
			}
			models.sort((a, b) => b.id.localeCompare(a.id));
			return preferFirst(models, PREFERRED);
		},
		async effortFields(_model, effort) {
			return { reasoning_effort: effort === 'max' ? 'high' : effort };
		},
		async supportsSchema() {
			return true;
		}
	});
}

export const openaiProvider = createOpenAiProvider();
