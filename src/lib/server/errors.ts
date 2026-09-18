/** An error that maps directly to an HTTP status. The message is safe to show to the caller. */
export class AppError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'AppError';
	}
}

export const badRequest = (message: string) => new AppError(400, message);
export const forbidden = (message: string) => new AppError(403, message);
export const notFound = (message: string) => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);
export const tooMany = (message: string) => new AppError(429, message);
export const upstream = (message: string) => new AppError(502, message);
