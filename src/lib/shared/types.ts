import { MODES } from './constants';

export type EventMode = (typeof MODES)[number];
export type EventState = 'open' | 'closed' | 'published';
export type ParticipantStatus = 'pending' | 'approved' | 'rejected';
export type PointType = 'reason' | 'condition' | 'constraint' | 'suggestion' | 'cost';
export type Budget = { kind: 'limit'; amount: number } | { kind: 'no_limit' } | null;

export type OptionCount = { optionId: string; count: number };
/** ranks[i] is how many approved participants ranked the option at position i + 1. */
export type RankRow = { optionId: string; ranks: number[]; unranked: number };
export type BordaRow = { optionId: string; score: number };
export type CostAggregateRow = { optionId: string; cost: number; overBudget: number };

/** Raw aggregates, computed at close and stored on the event. Never sent to a client as is. */
export type Aggregates = {
	approvedCount: number;
	firstChoice: OptionCount[];
	rankMatrix: RankRow[];
	vetoes: OptionCount[];
	borda: BordaRow[];
	condorcetWinner: string | null;
	cost: { answered: number; rows: CostAggregateRow[] } | null;
};

/** A cost count is null whenever it is below the display threshold. */
export type CostRow = { optionId: string; cost: number; overBudget: number | null };

/** Aggregates after the suppression rules. This is what hosts and reports see. */
export type PresentedTallies = {
	approvedCount: number;
	breakdown: null | {
		firstChoice: OptionCount[];
		rankMatrix: RankRow[];
		vetoes: OptionCount[];
		borda: BordaRow[];
		condorcetWinner: string | null;
		cost: null | { answered: number | null; rows: CostRow[] };
	};
};

export type OptionView = { id: string; label: string; note: string; cost: number | null };

export type EventView = {
	code: string;
	title: string;
	context: string;
	currency: string;
	mode: EventMode;
	state: EventState;
	rosterFinal: boolean;
	closesAt: string | null;
	closedAt: string | null;
	options: OptionView[];
};

export type MineView = {
	name: string;
	ranking: string[];
	vetoes: string[];
	budget: Budget;
	opinion: string;
	suggestion: string;
};

export type RosterRow = { id: string; name: string; status: ParticipantStatus; duplicate: boolean };

/** One event on the host home screen: counts and the pending names a host decides on, nothing else. */
export type AccountEvent = {
	code: string;
	title: string;
	state: EventState;
	rosterFinal: boolean;
	submittedCount: number;
	pendingCount: number;
	approvedCount: number;
	pending: RosterRow[];
	createdAt: string;
};

export type HostView = {
	submittedCount: number;
	pendingCount: number;
	roster: RosterRow[];
	tallies: PresentedTallies | null;
	hasDraft: boolean;
};

export type EventPageView = {
	role: 'host' | 'participant';
	event: EventView;
	mine: MineView | null;
	host: HostView | null;
};
