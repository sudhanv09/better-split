export type Member = {
	id: string;
	name: string;
};

export type Payer = {
	memberId: string;
	amountCents: number;
};

export type Expense = {
	id: string;
	description: string;
	payers: Payer[];
	splitMemberIds: string[];
	totalCents: number;
	createdAt: string;
};

export type Balance = {
	memberId: string;
	paid: number;
	owed: number;
	net: number;
};

export type Settlement = {
	from: string;
	to: string;
	amount: number;
};

export function createId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function parseAmountCents(value: string): number | null {
	const amount = Number(value);
	if (!Number.isFinite(amount) || amount <= 0) return null;
	return Math.round(amount * 100);
}

export function formatMoney(cents: number): string {
	return (cents / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

export function calculateBalances(
	members: Member[],
	expenses: Expense[],
): Balance[] {
	const balances = new Map<string, Balance>(
		members.map((member) => [
			member.id,
			{ memberId: member.id, paid: 0, owed: 0, net: 0 },
		]),
	);

	for (const expense of expenses) {
		for (const payer of expense.payers) {
			const balance = balances.get(payer.memberId);
			if (balance) balance.paid += payer.amountCents;
		}

		const splitIds = expense.splitMemberIds.filter((id) => balances.has(id));
		if (splitIds.length === 0) continue;

		const baseShare = Math.floor(expense.totalCents / splitIds.length);
		const remainder = expense.totalCents % splitIds.length;

		splitIds.forEach((id, index) => {
			const balance = balances.get(id)!;
			balance.owed += baseShare + (index < remainder ? 1 : 0);
		});
	}

	for (const balance of balances.values()) {
		balance.net = balance.paid - balance.owed;
	}

	return [...balances.values()];
}

export function calculateSettlements(balances: Balance[]): Settlement[] {
	const debtors = balances
		.filter((b) => b.net < 0)
		.map((b) => ({ memberId: b.memberId, amount: -b.net }))
		.sort((a, b) => b.amount - a.amount);

	const creditors = balances
		.filter((b) => b.net > 0)
		.map((b) => ({ memberId: b.memberId, amount: b.net }))
		.sort((a, b) => b.amount - a.amount);

	const settlements: Settlement[] = [];
	let d = 0;
	let c = 0;

	while (d < debtors.length && c < creditors.length) {
		const debtor = debtors[d];
		const creditor = creditors[c];
		const amount = Math.min(debtor.amount, creditor.amount);

		if (amount > 0) {
			settlements.push({
				from: debtor.memberId,
				to: creditor.memberId,
				amount,
			});
		}

		debtor.amount -= amount;
		creditor.amount -= amount;

		if (debtor.amount === 0) d += 1;
		if (creditor.amount === 0) c += 1;
	}

	return settlements;
}

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarHue(id: string): number {
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
	}
	return hash % 360;
}
