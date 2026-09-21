export function mergeEvent(
	targetPath: string,
	sourcePath: string,
	code: string
): {
	code: string;
	title: string;
	copied: { events: number; options: number; participants: number; responses: number };
};
