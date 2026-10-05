import type { TransactionItem } from "@/features/transactions/components/types";
import type { SplitGroupContext } from "@/features/transactions/lib/split-group";
import { getTodayDateString } from "@/shared/utils/date";
import { derivePeriodFromDate, getNextPeriod } from "@/shared/utils/period";
import {
	DEFAULT_RECURRENCE_COUNT,
	PAYMENT_METHODS,
	SPLIT_MODES,
	TRANSACTION_CONDITIONS,
	TRANSACTION_TYPES,
} from "./constants";

/**
 * Derives the fatura period for a credit card purchase based on closing day
 * and due day. The period represents the month the fatura is due (vencimento).
 *
 * Steps:
 * 1. If purchase day >= closing day → the purchase missed this month's closing,
 *    so it enters the NEXT month's billing cycle (+1 month from purchase).
 * 2. Then, if dueDay < closingDay, the due date falls in the month AFTER the
 *    closing month (e.g., closes 22nd, due 1st → closes Mar/22, due Apr/1),
 *    so we add another +1 month.
 *
 * @example
 * // Card closes day 22, due day 1 (dueDay < closingDay → +1 extra)
 * deriveCreditCardPeriod("2026-02-25", "22", "1")  // "2026-04" (missed Feb closing → Mar cycle → due Apr)
 * deriveCreditCardPeriod("2026-02-15", "22", "1")  // "2026-03" (in Feb cycle → due Mar)
 *
 * // Card closes day 5, due day 15 (dueDay >= closingDay → no extra)
 * deriveCreditCardPeriod("2026-02-10", "5", "15")  // "2026-03" (missed Feb closing → Mar cycle → due Mar)
 * deriveCreditCardPeriod("2026-02-05", "5", "15")  // "2026-03" (closing day itself already goes to next cycle)
 * deriveCreditCardPeriod("2026-02-03", "5", "15")  // "2026-02" (in Feb cycle → due Feb)
 */
export function deriveCreditCardPeriod(
	purchaseDate: string,
	closingDay: string | null | undefined,
	dueDay?: string | null | undefined,
): string {
	const basePeriod = derivePeriodFromDate(purchaseDate);
	if (!closingDay) return basePeriod;

	const closingDayNum = Number.parseInt(closingDay, 10);
	if (Number.isNaN(closingDayNum)) return basePeriod;

	const dayPart = purchaseDate.split("-")[2];
	const purchaseDayNum = Number.parseInt(dayPart ?? "1", 10);

	// Start with the purchase month as the billing cycle
	let period = basePeriod;

	// If purchase is on/after closing day, it enters the next billing cycle
	if (purchaseDayNum >= closingDayNum) {
		period = getNextPeriod(period);
	}

	// If due day < closing day, the due date falls in the month after closing
	// (e.g., closes 22nd, due 1st → closing in March means due in April)
	const dueDayNum = Number.parseInt(dueDay ?? "", 10);
	if (!Number.isNaN(dueDayNum) && dueDayNum < closingDayNum) {
		period = getNextPeriod(period);
	}

	return period;
}

function resolveRatio(
	ratio: number | undefined,
	amount: string,
	totalAmount: number,
): number {
	if (typeof ratio === "number" && Number.isFinite(ratio)) {
		return ratio;
	}
	if (totalAmount <= 0) return 0;
	return (Number.parseFloat(amount) || 0) / totalAmount;
}

export function amountFromRatio(ratio: number, totalAmount: number): string {
	if (totalAmount <= 0 || !Number.isFinite(ratio)) return "0.00";
	const cents = Math.round(ratio * Math.round(totalAmount * 100));
	return (Math.max(0, cents) / 100).toFixed(2);
}

/**
 * Converts ratios into cent-rounded amounts that sum to the total.
 * The remainder goes to the largest part so the stored ratios stay intact.
 */
export function allocateAmountsFromRatios(
	ratios: number[],
	totalAmount: number,
): string[] {
	if (ratios.length === 0 || totalAmount <= 0) {
		return ratios.map(() => "0.00");
	}

	const targetCents = Math.round(totalAmount * 100);
	const cents = ratios.map((ratio) =>
		Math.max(0, Math.round((Number.isFinite(ratio) ? ratio : 0) * targetCents)),
	);
	const diff = targetCents - cents.reduce((sum, value) => sum + value, 0);

	if (diff !== 0) {
		let index = 0;
		for (let cursor = 1; cursor < cents.length; cursor += 1) {
			if ((cents[cursor] ?? 0) > (cents[index] ?? 0)) {
				index = cursor;
			}
		}
		cents[index] = Math.max(0, (cents[index] ?? 0) + diff);
	}

	return cents.map((value) => (value / 100).toFixed(2));
}

/**
 * Form state type for lancamento dialog
 */
export type TransactionFormState = {
	purchaseDate: string;
	period: string;
	name: string;
	transactionType: string;
	amount: string;
	condition: string;
	paymentMethod: string;
	payerId: string | undefined;
	secondaryPayerId: string | undefined;
	splitShares: Array<{ payerId: string; amount: string; ratio?: number }>;
	isSplit: boolean;
	splitMode: string;
	primarySplitAmount: string;
	/** Fração do total da pessoa principal. Não muda quando só o valor total muda. */
	primarySplitRatio?: number;
	secondarySplitAmount: string;
	/** Receita avulsa marcada como a receber de alguém (sem divisão). */
	isReceivable: boolean;
	reimbursementDebtorId: string | undefined;
	accountId: string | undefined;
	cardId: string | undefined;
	categoryId: string | undefined;
	installmentCount: string;
	startInstallment: string;
	recurrenceCount: string;
	dueDate: string;
	boletoPaymentDate: string;
	note: string;
	isSettled: boolean | null;
};

/**
 * Initial state overrides for lancamento form
 */
type TransactionFormOverrides = {
	defaultCardId?: string | null;
	defaultAccountId?: string | null;
	defaultPaymentMethod?: string | null;
	defaultPurchaseDate?: string | null;
	defaultName?: string | null;
	defaultAmount?: string | null;
	defaultTransactionType?: "Despesa" | "Receita";
	isImporting?: boolean;
	splitContext?: SplitGroupContext | null;
};

/**
 * Builds a TransactionItem-shaped view of the expense anchor when editing
 * a reimbursement receivable, so the form shows the full group context.
 */
export function resolveEditTransactionAnchor(
	transaction: TransactionItem | undefined,
	splitContext?: SplitGroupContext | null,
): TransactionItem | undefined {
	if (!transaction || !splitContext?.expense) return transaction;
	if (splitContext.splitMode !== SPLIT_MODES.REIMBURSEMENT) return transaction;

	const expense = splitContext.expense;

	return {
		...transaction,
		id: expense.id,
		name: expense.name,
		purchaseDate: expense.purchaseDate || transaction.purchaseDate,
		period: expense.period,
		transactionType: expense.transactionType,
		amount: Number(expense.amount),
		condition: expense.condition,
		paymentMethod: expense.paymentMethod,
		payerId: expense.payerId,
		accountId: expense.accountId,
		cardId: expense.cardId,
		categoryId: expense.categoryId,
		note: expense.note,
		isSettled: expense.isSettled,
		dueDate: expense.dueDate,
		boletoPaymentDate: expense.boletoPaymentDate,
		installmentCount: expense.installmentCount,
		currentInstallment: expense.currentInstallment,
		recurrenceCount: expense.recurrenceCount,
		seriesId: expense.seriesId,
		splitGroupId: expense.splitGroupId,
		splitMode: expense.splitMode,
		isDivided: expense.isDivided,
		reimbursementDebtorId: null,
		reimbursementDebtorName: null,
		reimbursementDebtorAvatar: null,
	};
}

/**
 * Builds initial form state from lancamento data and defaults
 */
export function buildTransactionInitialState(
	transaction?: TransactionItem,
	defaultPayerId?: string | null,
	preferredPeriod?: string,
	overrides?: TransactionFormOverrides,
): TransactionFormState {
	const splitContext = overrides?.splitContext ?? null;
	const anchored = resolveEditTransactionAnchor(transaction, splitContext);

	const purchaseDate = anchored?.purchaseDate
		? anchored.purchaseDate.slice(0, 10)
		: (overrides?.defaultPurchaseDate ?? getTodayDateString());

	const paymentMethod =
		anchored?.paymentMethod ??
		overrides?.defaultPaymentMethod ??
		PAYMENT_METHODS[0];

	const derivedPeriod = derivePeriodFromDate(purchaseDate);
	const fallbackPeriod =
		preferredPeriod && /^\d{4}-\d{2}$/.test(preferredPeriod)
			? preferredPeriod
			: derivedPeriod;

	// Quando importando, usar valores padrão do usuário logado ao invés dos valores do lançamento original
	const isImporting = overrides?.isImporting ?? false;
	const fallbackPayerId = isImporting
		? (defaultPayerId ?? null)
		: (anchored?.payerId ?? defaultPayerId ?? null);

	const boletoPaymentDate =
		anchored?.boletoPaymentDate ??
		(paymentMethod === "Boleto" && (anchored?.isSettled ?? false)
			? getTodayDateString()
			: "");

	// Calcular o valor correto para importação de parcelados
	let amountValue = overrides?.defaultAmount ?? "";
	if (!amountValue && typeof anchored?.amount === "number") {
		let baseAmount = Math.abs(anchored.amount);

		// Se está importando e é parcelado, usar o valor total (parcela * quantidade)
		if (
			isImporting &&
			anchored.condition === "Parcelado" &&
			anchored.installmentCount
		) {
			baseAmount = baseAmount * anchored.installmentCount;
		}

		amountValue = (Math.round(baseAmount * 100) / 100).toFixed(2);
	}

	const hasSplit =
		Boolean(splitContext) &&
		(splitContext?.splitShares.length ?? 0) > 0 &&
		!isImporting;

	const totalForRatio = Number.parseFloat(amountValue) || 0;
	const initialSplitShares = hasSplit
		? (splitContext?.splitShares ?? []).map((share) => ({
				payerId: share.payerId,
				amount: share.amount,
				ratio: totalForRatio > 0 ? Number(share.amount) / totalForRatio : 0,
			}))
		: [];
	const isCostShare =
		(splitContext?.splitMode ?? anchored?.splitMode) === SPLIT_MODES.COST_SHARE;
	const primarySplitRatio =
		hasSplit && isCostShare && totalForRatio > 0
			? Number(splitContext?.primarySplitAmount ?? 0) / totalForRatio
			: undefined;

	const standaloneReceivableId =
		!hasSplit &&
		!isImporting &&
		anchored?.transactionType === "Receita" &&
		anchored?.reimbursementDebtorId &&
		!anchored?.splitGroupId
			? anchored.reimbursementDebtorId
			: undefined;

	return {
		purchaseDate,
		period:
			anchored?.period && /^\d{4}-\d{2}$/.test(anchored.period)
				? anchored.period
				: fallbackPeriod,
		name: anchored?.name ?? overrides?.defaultName ?? "",
		transactionType:
			anchored?.transactionType ??
			overrides?.defaultTransactionType ??
			TRANSACTION_TYPES[0],
		amount: amountValue,
		condition: anchored?.condition ?? TRANSACTION_CONDITIONS[0],
		paymentMethod,
		payerId: fallbackPayerId ?? undefined,
		secondaryPayerId: undefined,
		splitShares: initialSplitShares,
		isSplit: hasSplit,
		splitMode:
			splitContext?.splitMode ??
			anchored?.splitMode ??
			SPLIT_MODES.REIMBURSEMENT,
		primarySplitAmount: hasSplit
			? (splitContext?.primarySplitAmount ?? "")
			: "",
		primarySplitRatio,
		secondarySplitAmount: "",
		isReceivable: Boolean(standaloneReceivableId),
		reimbursementDebtorId: standaloneReceivableId,
		accountId:
			paymentMethod === "Cartão de crédito"
				? undefined
				: isImporting
					? undefined
					: (anchored?.accountId ?? overrides?.defaultAccountId ?? undefined),
		cardId:
			paymentMethod === "Cartão de crédito"
				? isImporting
					? (overrides?.defaultCardId ?? undefined)
					: (anchored?.cardId ?? overrides?.defaultCardId ?? undefined)
				: undefined,
		categoryId: isImporting ? undefined : (anchored?.categoryId ?? undefined),
		installmentCount: anchored?.installmentCount
			? String(anchored.installmentCount)
			: "",
		startInstallment:
			isImporting &&
			anchored?.condition === "Parcelado" &&
			anchored.currentInstallment
				? String(anchored.currentInstallment)
				: "1",
		recurrenceCount: anchored?.recurrenceCount
			? String(anchored.recurrenceCount)
			: anchored?.condition === "Recorrente"
				? String(DEFAULT_RECURRENCE_COUNT)
				: "",
		dueDate: anchored?.dueDate ?? "",
		boletoPaymentDate,
		note: anchored?.note ?? "",
		isSettled:
			paymentMethod === "Cartão de crédito"
				? null
				: (anchored?.isSettled ?? true),
	};
}

/**
 * Applies field dependencies when form state changes
 * This function encapsulates the business logic for field interdependencies
 */
export function applyFieldDependencies(
	key: keyof TransactionFormState,
	value: TransactionFormState[keyof TransactionFormState],
	currentState: TransactionFormState,
	cardInfo?: { closingDay: string | null; dueDay: string | null } | null,
): Partial<TransactionFormState> {
	const updates: Partial<TransactionFormState> = {};

	// Auto-derive period from purchaseDate
	if (key === "purchaseDate" && typeof value === "string" && value) {
		const method = currentState.paymentMethod;
		if (method === "Cartão de crédito") {
			updates.period = deriveCreditCardPeriod(
				value,
				cardInfo?.closingDay,
				cardInfo?.dueDay,
			);
		} else if (method !== "Boleto") {
			updates.period = derivePeriodFromDate(value);
		}
	}

	// Auto-derive period from dueDate when payment method is boleto
	if (key === "dueDate" && typeof value === "string" && value) {
		if (currentState.paymentMethod === "Boleto") {
			updates.period = derivePeriodFromDate(value);
		}
	}

	// Auto-derive period when cardId changes (credit card selected)
	if (key === "cardId" && currentState.paymentMethod === "Cartão de crédito") {
		if (typeof value === "string" && value && currentState.purchaseDate) {
			updates.period = deriveCreditCardPeriod(
				currentState.purchaseDate,
				cardInfo?.closingDay,
				cardInfo?.dueDay,
			);
		}
	}

	// When condition changes, clear irrelevant fields
	if (key === "condition" && typeof value === "string") {
		if (value !== "Parcelado") {
			updates.installmentCount = "";
			updates.startInstallment = "1";
		}
		if (value !== "Recorrente") {
			updates.recurrenceCount = "";
		} else {
			updates.recurrenceCount = String(DEFAULT_RECURRENCE_COUNT);
		}
	}

	if (key === "installmentCount" && typeof value === "string" && value) {
		const nextCount = Number.parseInt(value, 10);
		const currentStart = Number.parseInt(currentState.startInstallment, 10);
		if (
			!Number.isNaN(nextCount) &&
			!Number.isNaN(currentStart) &&
			currentStart > nextCount
		) {
			updates.startInstallment = String(nextCount);
		}
	}

	// When payment method changes, adjust related fields
	if (key === "paymentMethod" && typeof value === "string") {
		if (value === "Cartão de crédito") {
			updates.accountId = undefined;
			updates.isSettled = null;
		} else {
			updates.cardId = undefined;
			updates.isSettled = currentState.isSettled ?? true;
		}

		// Re-derive period based on new payment method
		if (value === "Cartão de crédito") {
			if (
				currentState.purchaseDate &&
				currentState.cardId &&
				cardInfo?.closingDay
			) {
				updates.period = deriveCreditCardPeriod(
					currentState.purchaseDate,
					cardInfo.closingDay,
					cardInfo.dueDay,
				);
			} else if (currentState.purchaseDate) {
				updates.period = derivePeriodFromDate(currentState.purchaseDate);
			}
		} else if (value === "Boleto" && currentState.dueDate) {
			updates.period = derivePeriodFromDate(currentState.dueDate);
		} else if (currentState.purchaseDate) {
			updates.period = derivePeriodFromDate(currentState.purchaseDate);
		}

		// Clear boleto-specific fields if not boleto
		if (value !== "Boleto") {
			updates.dueDate = "";
			updates.boletoPaymentDate = "";
		} else if (
			currentState.isSettled ||
			(updates.isSettled !== null && updates.isSettled !== undefined)
		) {
			// Set today's date for boleto payment if settled
			const settled = updates.isSettled ?? currentState.isSettled;
			if (settled) {
				updates.boletoPaymentDate =
					currentState.boletoPaymentDate || getTodayDateString();
			}
		}
	}

	// When split is disabled, clear secondary pagador and split fields
	if (key === "isSplit" && value === false) {
		updates.secondaryPayerId = undefined;
		updates.splitShares = [];
		updates.primarySplitAmount = "";
		updates.primarySplitRatio = undefined;
		updates.secondarySplitAmount = "";
		updates.splitMode = SPLIT_MODES.REIMBURSEMENT;
	}

	// When split is enabled, clear standalone receivable and set initial amounts
	if (key === "isSplit" && value === true) {
		updates.isReceivable = false;
		updates.reimbursementDebtorId = undefined;
		updates.splitMode = SPLIT_MODES.REIMBURSEMENT;
		const totalAmount = Number.parseFloat(currentState.amount) || 0;
		if (totalAmount > 0) {
			updates.primarySplitAmount = totalAmount.toFixed(2);
			updates.primarySplitRatio = 1;
			updates.secondarySplitAmount = "";
		}
	}

	if (key === "splitShares" && Array.isArray(value)) {
		const totalAmount = Number.parseFloat(currentState.amount) || 0;
		updates.splitShares = value.map((share) => ({
			...share,
			ratio: resolveRatio(share.ratio, share.amount, totalAmount),
		}));
	}

	if (key === "primarySplitAmount" && typeof value === "string") {
		const totalAmount = Number.parseFloat(currentState.amount) || 0;
		updates.primarySplitRatio = resolveRatio(undefined, value, totalAmount);
	}

	// When amount changes and split is enabled, recalculate split amounts
	// from the stored ratios. The currency field emits every digit, so scaling
	// from the previous rounded amount would drift the percentage.
	if (key === "amount" && typeof value === "string" && currentState.isSplit) {
		const totalAmount = Number.parseFloat(value) || 0;
		const previousTotal = Number.parseFloat(currentState.amount) || 0;

		if (totalAmount <= 0) {
			updates.primarySplitAmount = "";
			updates.primarySplitRatio = resolveRatio(
				currentState.primarySplitRatio,
				currentState.primarySplitAmount,
				previousTotal,
			);
			updates.splitShares = currentState.splitShares.map((share) => ({
				...share,
				amount: "",
				ratio: resolveRatio(share.ratio, share.amount, previousTotal),
			}));
		} else if (
			currentState.splitMode === SPLIT_MODES.REIMBURSEMENT &&
			currentState.splitShares.length > 0
		) {
			const ratios = currentState.splitShares.map((share) =>
				resolveRatio(share.ratio, share.amount, previousTotal),
			);
			const totalCents = Math.round(totalAmount * 100);
			const cents = ratios.map((ratio) =>
				Math.max(0, Math.round(ratio * totalCents)),
			);
			let receivableCents = cents.reduce((sum, value) => sum + value, 0);
			if (receivableCents > totalCents && cents.length > 0) {
				let index = 0;
				for (let cursor = 1; cursor < cents.length; cursor += 1) {
					if ((cents[cursor] ?? 0) > (cents[index] ?? 0)) {
						index = cursor;
					}
				}
				cents[index] = Math.max(
					0,
					(cents[index] ?? 0) - (receivableCents - totalCents),
				);
				receivableCents = cents.reduce((sum, value) => sum + value, 0);
			}
			updates.splitShares = currentState.splitShares.map((share, index) => ({
				...share,
				amount: ((cents[index] ?? 0) / 100).toFixed(2),
				ratio: ratios[index],
			}));
			updates.primarySplitAmount = (
				(totalCents - receivableCents) /
				100
			).toFixed(2);
		} else if (currentState.splitMode === SPLIT_MODES.COST_SHARE) {
			const ratios = [
				resolveRatio(
					currentState.primarySplitRatio,
					currentState.primarySplitAmount,
					previousTotal,
				),
				...currentState.splitShares.map((share) =>
					resolveRatio(share.ratio, share.amount, previousTotal),
				),
			];
			const amounts = allocateAmountsFromRatios(ratios, totalAmount);
			updates.primarySplitAmount = amounts[0] ?? "0.00";
			updates.primarySplitRatio = ratios[0];
			updates.splitShares = currentState.splitShares.map((share, index) => ({
				...share,
				amount: amounts[index + 1] ?? "0.00",
				ratio: ratios[index + 1],
			}));
		} else if (totalAmount > 0) {
			const otherTotal = currentState.splitShares.reduce(
				(total, share) => total + (Number.parseFloat(share.amount) || 0),
				0,
			);
			updates.primarySplitAmount = Math.max(
				0,
				totalAmount - otherTotal,
			).toFixed(2);
		}
	}

	// When primary pagador changes, clear secondary if it matches
	if (key === "payerId" && typeof value === "string") {
		const secondaryValue = currentState.secondaryPayerId;
		if (secondaryValue && secondaryValue === value) {
			updates.secondaryPayerId = undefined;
		}
		if (currentState.reimbursementDebtorId === value) {
			updates.reimbursementDebtorId = undefined;
		}
		if (currentState.splitShares.some((share) => share.payerId === value)) {
			const nextShares = currentState.splitShares.filter(
				(share) => share.payerId !== value,
			);
			updates.splitShares = nextShares;
			if (currentState.isSplit) {
				const totalAmount = Number.parseFloat(currentState.amount) || 0;
				const otherTotal = nextShares.reduce(
					(total, share) => total + (Number.parseFloat(share.amount) || 0),
					0,
				);
				const primaryAmount = Math.max(0, totalAmount - otherTotal);
				updates.primarySplitAmount = primaryAmount.toFixed(2);
				updates.primarySplitRatio =
					totalAmount > 0 ? primaryAmount / totalAmount : 0;
			}
		}
	}

	// Receita avulsa a receber: limpar ao sair de Receita
	if (key === "transactionType" && value !== "Receita") {
		updates.isReceivable = false;
		updates.reimbursementDebtorId = undefined;
	}

	if (key === "isReceivable") {
		if (value === true) {
			updates.isSplit = false;
			updates.secondaryPayerId = undefined;
			updates.splitShares = [];
			updates.primarySplitAmount = "";
			updates.primarySplitRatio = undefined;
			updates.secondarySplitAmount = "";
			updates.splitMode = SPLIT_MODES.REIMBURSEMENT;
			if (currentState.paymentMethod !== "Cartão de crédito") {
				updates.isSettled = false;
			}
		} else {
			updates.reimbursementDebtorId = undefined;
		}
	}

	// When isSettled changes and payment method is Boleto
	if (key === "isSettled" && currentState.paymentMethod === "Boleto") {
		if (value === true) {
			updates.boletoPaymentDate =
				currentState.boletoPaymentDate || getTodayDateString();
		} else if (value === false) {
			updates.boletoPaymentDate = "";
		}
	}

	return updates;
}
