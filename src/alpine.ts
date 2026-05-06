import type { Alpine } from "alpinejs";
import {
	avatarHue,
	calculateBalances,
	calculateSettlements,
	createId,
	formatMoney,
	initials,
	parseAmountCents,
	type Expense,
	type Member,
} from "./lib/split";

type Stage = "onboarding" | "workspace";
type PayerDraft = { id: string; memberId: string; amount: string };
type Persisted = {
	stage: Stage;
	groupName: string;
	members: Member[];
	expenses: Expense[];
};
type Msg = { text: string; type: "" | "error" | "success"; visible: boolean };

const STORAGE_KEY = "better-split:session:v1";
const THEME_KEY = "better-split:theme";

type Theme = "light" | "dark";

function readSavedTheme(): Theme {
	try {
		const stored = localStorage.getItem(THEME_KEY);
		if (stored === "dark" || stored === "light") return stored;
	} catch {}
	const attr = document.documentElement.getAttribute("data-theme");
	return attr === "dark" ? "dark" : "light";
}

function readSavedSession(): Persisted | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const data = JSON.parse(raw) as Partial<Persisted> | null;
		if (
			!data ||
			typeof data.groupName !== "string" ||
			!Array.isArray(data.members) ||
			!Array.isArray(data.expenses)
		) {
			return null;
		}
		const stage: Stage =
			data.stage === "workspace" ? "workspace" : "onboarding";
		return {
			stage,
			groupName: data.groupName,
			members: data.members as Member[],
			expenses: data.expenses as Expense[],
		};
	} catch {
		return null;
	}
}

function emptyPayer(memberId = ""): PayerDraft {
	return { id: createId(), memberId, amount: "" };
}

export default (Alpine: Alpine) => {
	Alpine.data("app", () => ({
		stage: "onboarding" as Stage,
		groupName: "",
		members: [] as Member[],
		expenses: [] as Expense[],
		payerRows: [emptyPayer()] as PayerDraft[],
		selectedSplitIds: [] as string[],
		expenseDescription: "",
		memberNameInput: "",
		memberMessage: { text: "", type: "", visible: false } as Msg,
		expenseMessage: { text: "", type: "", visible: false } as Msg,
		resumeVisible: false,
		resumeSnapshot: null as Persisted | null,
		sessionLoaded: false,
		theme: "light" as Theme,
		_msgTimers: {} as Record<string, number>,

		init() {
			this.theme = readSavedTheme();
			document.documentElement.setAttribute("data-theme", this.theme);
			this.$watch("theme", (value: Theme) => {
				document.documentElement.setAttribute("data-theme", value);
				try {
					localStorage.setItem(THEME_KEY, value);
				} catch {}
			});

			const saved = readSavedSession();
			const hasSaved =
				!!saved &&
				(saved.groupName.length > 0 ||
					saved.members.length > 0 ||
					saved.expenses.length > 0);
			if (hasSaved && saved) {
				this.resumeSnapshot = saved;
				this.resumeVisible = true;
			} else {
				this.sessionLoaded = true;
			}

			const onChange = () => this.persist();
			this.$watch("stage", onChange);
			this.$watch("groupName", onChange);
			this.$watch("members", onChange);
			this.$watch("expenses", onChange);
		},

		// Computed

		get balances() {
			return calculateBalances(this.members, this.expenses);
		},
		get balanceMax() {
			return Math.max(1, ...this.balances.map((b) => Math.abs(b.net)));
		},
		get settlements() {
			return calculateSettlements(this.balances);
		},
		get paidTotalCents() {
			return this.payerRows.reduce(
				(t, r) => t + (parseAmountCents(r.amount) || 0),
				0,
			);
		},
		get paidTotalDisplay() {
			return formatMoney(this.paidTotalCents);
		},
		get continueReady() {
			return this.groupName.trim().length > 0 && this.members.length >= 2;
		},
		get continueHint() {
			if (this.members.length < 2)
				return "Add at least two members to split with.";
			if (this.groupName.trim().length === 0) return "Give the group a name.";
			return "Ready when you are.";
		},
		get countsLabel() {
			const m = this.members.length;
			const t = this.expenses.length;
			return `${m} member${m === 1 ? "" : "s"} · ${t} transaction${t === 1 ? "" : "s"}`;
		},
		get resumeCounts() {
			const s = this.resumeSnapshot;
			if (!s) return "";
			const m = s.members.length;
			const t = s.expenses.length;
			return `${m} member${m === 1 ? "" : "s"} · ${t} transaction${t === 1 ? "" : "s"}`;
		},

		// Template helpers

		avatarStyle(id: string) {
			return `background: hsl(${avatarHue(id)} 65% 45%);`;
		},
		initialsOf(name: string) {
			return initials(name);
		},
		money(cents: number) {
			return formatMoney(cents);
		},
		memberName(id: string) {
			return this.members.find((m) => m.id === id)?.name || "Unknown";
		},
		balancePct(net: number) {
			if (net === 0) return 0;
			return Math.round((Math.abs(net) / this.balanceMax) * 50);
		},
		balanceClass(net: number) {
			return net > 0 ? "positive" : net < 0 ? "negative" : "zero";
		},
		balanceSign(net: number) {
			return net > 0 ? "+" : net < 0 ? "−" : "";
		},
		messageClass(msg: Msg) {
			return {
				show: msg.visible,
				error: msg.type === "error",
				success: msg.type === "success",
			};
		},

		// Actions

		addMember() {
			const name = this.memberNameInput.trim();
			if (!name) return this.flash("memberMessage", "Enter a member name.", "error");
			if (
				this.members.some(
					(m) => m.name.toLowerCase() === name.toLowerCase(),
				)
			)
				return this.flash(
					"memberMessage",
					"That member already exists.",
					"error",
				);
			const member: Member = { id: createId(), name };
			this.members.push(member);
			this.selectedSplitIds.push(member.id);
			this.memberNameInput = "";
			this.flash("memberMessage", `${name} added.`, "success");
			this.ensureDraftDefaults();
		},

		removeMember(memberId: string) {
			const member = this.members.find((m) => m.id === memberId);
			if (!member) return;
			const used = this.expenses.some(
				(e) =>
					e.splitMemberIds.includes(memberId) ||
					e.payers.some((p) => p.memberId === memberId),
			);
			if (used)
				return this.flash(
					"memberMessage",
					"Delete that member's transactions first.",
					"error",
				);
			this.members = this.members.filter((m) => m.id !== memberId);
			this.selectedSplitIds = this.selectedSplitIds.filter(
				(id) => id !== memberId,
			);
			this.payerRows = this.payerRows.map((r) =>
				r.memberId === memberId ? { ...r, memberId: "" } : r,
			);
			this.flash("memberMessage", `${member.name} removed.`, "success");
			this.ensureDraftDefaults();
		},

		ensureDraftDefaults() {
			const ids = new Set(this.members.map((m) => m.id));
			this.selectedSplitIds = this.selectedSplitIds.filter((id) =>
				ids.has(id),
			);
			if (this.selectedSplitIds.length === 0) {
				this.selectedSplitIds = this.members.map((m) => m.id);
			}
			const def = this.members[0]?.id || "";
			this.payerRows = this.payerRows.map((r) =>
				ids.has(r.memberId) ? r : { ...r, memberId: def },
			);
		},

		selectAllSplit() {
			this.selectedSplitIds = this.members.map((m) => m.id);
		},

		addPayerRow() {
			this.payerRows.push(emptyPayer(this.members[0]?.id || ""));
		},

		removePayerRow(id: string) {
			this.payerRows = this.payerRows.filter((r) => r.id !== id);
			if (this.payerRows.length === 0) this.payerRows = [emptyPayer()];
		},

		submitExpense() {
			if (this.members.length < 2)
				return this.flash(
					"expenseMessage",
					"Add at least two members first.",
					"error",
				);
			const totals = new Map<string, number>();
			for (const row of this.payerRows) {
				const hasInput = row.memberId || row.amount.trim();
				if (!hasInput) continue;
				if (!row.memberId)
					return this.flash(
						"expenseMessage",
						"Choose who paid for each payer row.",
						"error",
					);
				const cents = parseAmountCents(row.amount);
				if (!cents)
					return this.flash(
						"expenseMessage",
						"Enter a positive amount for each payer row.",
						"error",
					);
				totals.set(
					row.memberId,
					(totals.get(row.memberId) || 0) + cents,
				);
			}
			const items = [...totals.entries()].map(([memberId, amountCents]) => ({
				memberId,
				amountCents,
			}));
			if (items.length === 0)
				return this.flash(
					"expenseMessage",
					"Add at least one payer amount.",
					"error",
				);
			const splitMemberIds = this.members
				.map((m) => m.id)
				.filter((id) => this.selectedSplitIds.includes(id));
			if (splitMemberIds.length === 0)
				return this.flash(
					"expenseMessage",
					"Choose at least one person to split with.",
					"error",
				);
			const totalCents = items.reduce((t, p) => t + p.amountCents, 0);
			this.expenses.unshift({
				id: createId(),
				description: this.expenseDescription.trim() || "Untitled expense",
				payers: items,
				splitMemberIds,
				totalCents,
				createdAt: new Date().toISOString(),
			});
			this.expenseDescription = "";
			this.payerRows = [emptyPayer(this.members[0]?.id || "")];
			this.selectedSplitIds = this.members.map((m) => m.id);
			this.flash("expenseMessage", "Transaction added.", "success");
		},

		deleteExpense(id: string) {
			this.expenses = this.expenses.filter((e) => e.id !== id);
		},

		continueToWorkspace() {
			if (this.continueReady) this.stage = "workspace";
		},

		toggleTheme() {
			this.theme = this.theme === "dark" ? "light" : "dark";
		},

		resetAll() {
			this.groupName = "";
			this.members = [];
			this.expenses = [];
			this.payerRows = [emptyPayer()];
			this.selectedSplitIds = [];
			this.expenseDescription = "";
			this.memberNameInput = "";
			this.memberMessage = { text: "", type: "", visible: false };
			this.expenseMessage = { text: "", type: "", visible: false };
			this.resumeVisible = false;
			this.stage = "onboarding";
			try {
				localStorage.removeItem(STORAGE_KEY);
			} catch {}
		},

		resumeConfirm() {
			const saved = this.resumeSnapshot;
			if (!saved) {
				this.resumeVisible = false;
				this.sessionLoaded = true;
				return;
			}
			this.groupName = saved.groupName;
			this.members = saved.members;
			this.expenses = saved.expenses;
			this.selectedSplitIds = saved.members.map((m) => m.id);
			this.payerRows = [emptyPayer(saved.members[0]?.id || "")];
			this.resumeVisible = false;
			this.sessionLoaded = true;
			this.stage = saved.stage === "workspace" ? "workspace" : "onboarding";
		},

		resumeDismiss() {
			try {
				localStorage.removeItem(STORAGE_KEY);
			} catch {}
			this.resumeVisible = false;
			this.sessionLoaded = true;
		},

		persist() {
			if (!this.sessionLoaded) return;
			if (
				!this.groupName &&
				this.members.length === 0 &&
				this.expenses.length === 0
			) {
				try {
					localStorage.removeItem(STORAGE_KEY);
				} catch {}
				return;
			}
			try {
				const data: Persisted = {
					stage: this.stage,
					groupName: this.groupName,
					members: this.members,
					expenses: this.expenses,
				};
				localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
			} catch {}
		},

		flash(
			field: "memberMessage" | "expenseMessage",
			text: string,
			type: "error" | "success",
		) {
			this[field] = { text, type, visible: true };
			const prev = this._msgTimers[field];
			if (prev) clearTimeout(prev);
			const ms = type === "error" ? 3500 : 2200;
			this._msgTimers[field] = window.setTimeout(() => {
				this[field] = { text: "", type: "", visible: false };
				delete this._msgTimers[field];
			}, ms);
		},
	}));
};
