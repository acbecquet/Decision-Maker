import { isTokenShape, safeEqualHex, sha256Hex } from './crypto';
import type { DbLike } from './db';
import type { EventRow, ParticipantRow } from './db/schema';
import { forbidden } from './errors';
import { findParticipantByDevice } from './participants';

export type TokenHeader = 'x-host-token' | 'x-participant-token';

/** Reads a token header and returns it only when it has the exact 64-hex shape. */
export function tokenFromHeader(request: Request, name: TokenHeader): string | null {
	const value = request.headers.get(name);
	return isTokenShape(value) ? value : null;
}

/** A host is the device holding the host token, or a signed-in account that owns the event. */
export function isHost(
	event: EventRow,
	request: Request,
	accountId: string | null = null
): boolean {
	if (accountId && event.accountId === accountId) return true;
	const token = tokenFromHeader(request, 'x-host-token');
	return token !== null && safeEqualHex(sha256Hex(token), event.hostTokenHash);
}

export function requireHost(
	event: EventRow,
	request: Request,
	accountId: string | null = null
): void {
	if (!isHost(event, request, accountId)) throw forbidden('Host only');
}

export function participantFromRequest(
	db: DbLike,
	event: EventRow,
	request: Request
): ParticipantRow | undefined {
	const token = tokenFromHeader(request, 'x-participant-token');
	if (!token) return undefined;
	return findParticipantByDevice(db, event.id, sha256Hex(token));
}
