import { and, eq } from "drizzle-orm";
import { transactions } from "@/db/schema";
import { SPLIT_MODES } from "@/features/transactions/lib/constants";
import { db } from "@/shared/lib/db";

export type SplitGroupMember = {
	id: string;
	name: string;
	purchaseDate: string;
	period: string;
	transactionType: string;
	amount: string;
	condition: string;
	paymentMethod: string;
	payerId: string | null;
	accountId: string | null;
	cardId: string | null;
	categoryId: string | null;
	note: string | null;
	isSettled: boolean | null;
	dueDate: string | null;
	boletoPaymentDate: string | null;
	installmentCount: number | null;
	currentInstallment: number | null;
	recurrenceCount: number | null;
	seriesId: string | null;
	splitGroupId: string | null;
	splitMode: string | null;
	isDivided: boolean;
	reimbursementDebtorId: string | null;
};

export type SplitGroupContext = {
	splitGroupId: string;
	splitMode: string | null;
	expense: SplitGroupMember | null;
	members: SplitGroupMember[];
	receivables: SplitGroupMember[];
	/** Shares for the form (reimbursement debtors or cost_share secondary payers). */
	splitShares: Array<{ payerId: string; amount: string }>;
	primarySplitAmount: string;
	anchorId: string;
};

function toAmountString(amount: string | null | undefined): string {
	const value = Math.abs(Number(amount ?? 0));
	if (Number.isNaN(value)) return "0.00";
	return value.toFixed(2);
}

function toDateString(value: Date | string | null | undefined): string | null {
	if (!value) return null;
	if (typeof value === "string") return value.slice(0, 10);
	return value.toISOString().slice(0, 10);
}

export async function fetchSplitGroupMembers(
	userId: string,
	splitGroupId: string,
): Promise<SplitGroupMember[]> {
	const rows = await db.query.transactions.findMany({
		columns: {
			id: true,
			name: true,
			purchaseDate: true,
			period: true,
			transactionType: true,
			amount: true,
			condition: true,
			paymentMethod: true,
			payerId: true,
			accountId: true,
			cardId: true,
			categoryId: true,
			note: true,
			isSettled: true,
			dueDate: true,
			boletoPaymentDate: true,
			installmentCount: true,
			currentInstallment: true,
			recurrenceCount: true,
			seriesId: true,
			splitGroupId: true,
			splitMode: true,
			isDivided: true,
			reimbursementDebtorId: true,
		},
		where: and(
			eq(transactions.userId, userId),
			eq(transactions.splitGroupId, splitGroupId),
		),
	});

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		purchaseDate: toDateString(row.purchaseDate) ?? "",
		period: row.period,
		transactionType: row.transactionType,
		amount: row.amount ?? "0",
		condition: row.condition,
		paymentMethod: row.paymentMethod,
		payerId: row.payerId,
		accountId: row.accountId,
		cardId: row.cardId,
		categoryId: row.categoryId,
		note: row.note,
		isSettled: row.isSettled,
		dueDate: toDateString(row.dueDate),
		boletoPaymentDate: toDateString(row.boletoPaymentDate),
		installmentCount: row.installmentCount,
		currentInstallment: row.currentInstallment,
		recurrenceCount: row.recurrenceCount,
		seriesId: row.seriesId,
		splitGroupId: row.splitGroupId,
		splitMode: row.splitMode,
		isDivided: row.isDivided ?? false,
		reimbursementDebtorId: row.reimbursementDebtorId,
	}));
}

export function buildSplitGroupContext(
	members: SplitGroupMember[],
	preferredId?: string,
): SplitGroupContext | null {
	if (members.length === 0) return null;

	const splitGroupId = members[0]?.splitGroupId;
	if (!splitGroupId) return null;

	const splitMode = members.find((m) => m.splitMode)?.splitMode ?? null;
	const isReimbursement = splitMode === SPLIT_MODES.REIMBURSEMENT;

	const expense =
		members.find(
			(m) =>
				m.reimbursementDebtorId == null &&
				m.transactionType === "Despesa" &&
				(isReimbursement || members.length > 1),
		) ??
		members.find((m) => m.reimbursementDebtorId == null) ??
		null;

	const receivables = members.filter((m) => m.reimbursementDebtorId != null);

	if (isReimbursement) {
		const anchor =
			expense ?? members.find((m) => m.id === preferredId) ?? members[0];
		if (!anchor) return null;

		return {
			splitGroupId,
			splitMode,
			expense,
			members,
			receivables,
			splitShares: receivables
				.filter((m) => m.reimbursementDebtorId)
				.map((m) => ({
					payerId: m.reimbursementDebtorId as string,
					amount: toAmountString(m.amount),
				})),
			primarySplitAmount: toAmountString(expense?.amount ?? anchor.amount),
			anchorId: expense?.id ?? anchor.id,
		};
	}

	// cost_share: primary is preferred row or first member; others become shares
	const primary =
		members.find((m) => m.id === preferredId) ?? members[0] ?? null;
	if (!primary) return null;

	const others = members.filter((m) => m.id !== primary.id);

	return {
		splitGroupId,
		splitMode: splitMode ?? SPLIT_MODES.COST_SHARE,
		expense: primary,
		members,
		receivables: [],
		splitShares: others
			.filter((m) => m.payerId)
			.map((m) => ({
				payerId: m.payerId as string,
				amount: toAmountString(m.amount),
			})),
		primarySplitAmount: toAmountString(primary.amount),
		anchorId: primary.id,
	};
}

export async function fetchSplitGroupContext(
	userId: string,
	splitGroupId: string,
	preferredId?: string,
): Promise<SplitGroupContext | null> {
	const members = await fetchSplitGroupMembers(userId, splitGroupId);
	return buildSplitGroupContext(members, preferredId);
}
