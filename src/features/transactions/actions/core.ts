import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, ne, not, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
	cards,
	categories,
	financialAccounts,
	invoices,
	payers,
	transactions,
} from "@/db/schema";
import {
	DEFAULT_RECEIVABLE_PAYMENT_METHOD,
	DEFAULT_RECURRENCE_COUNT,
	MAX_RECURRENCE_COUNT,
	PAYMENT_METHODS,
	SPLIT_MODES,
	TRANSACTION_CONDITIONS,
	TRANSACTION_TYPES,
} from "@/features/transactions/lib/constants";
import {
	INITIAL_BALANCE_CONDITION,
	INITIAL_BALANCE_NOTE,
	INITIAL_BALANCE_PAYMENT_METHOD,
	INITIAL_BALANCE_TRANSACTION_TYPE,
} from "@/shared/lib/accounts/constants";
import { revalidateForEntity } from "@/shared/lib/actions/helpers";
import { db } from "@/shared/lib/db";
import { INVOICE_PAYMENT_STATUS } from "@/shared/lib/invoices";
import { noteSchema, uuidSchema } from "@/shared/lib/schemas/common";
import { addMonthsToDate, parseLocalDateString } from "@/shared/utils/date";
import { addMonthsToPeriod, MONTH_NAMES } from "@/shared/utils/period";

// ============================================================================
// Authorization Validation Functions
// ============================================================================

const normalizeIds = (ids: Array<string | null | undefined>) => [
	...new Set(ids.filter((id): id is string => Boolean(id))),
];

export async function fetchOwnedPayerIds(
	userId: string,
	payerIds: Array<string | null | undefined>,
): Promise<Set<string>> {
	const ids = normalizeIds(payerIds);
	if (ids.length === 0) {
		return new Set();
	}

	const rows = await db
		.select({ id: payers.id })
		.from(payers)
		.where(and(eq(payers.userId, userId), inArray(payers.id, ids)));

	return new Set(rows.map((row) => row.id));
}

export async function fetchOwnedCategoryIds(
	userId: string,
	categoryIds: Array<string | null | undefined>,
): Promise<Set<string>> {
	const ids = normalizeIds(categoryIds);
	if (ids.length === 0) {
		return new Set();
	}

	const rows = await db
		.select({ id: categories.id })
		.from(categories)
		.where(and(eq(categories.userId, userId), inArray(categories.id, ids)));

	return new Set(rows.map((row) => row.id));
}

export async function validateContaOwnership(
	userId: string,
	accountId: string | null | undefined,
): Promise<boolean> {
	if (!accountId) return true;

	const conta = await db.query.financialAccounts.findFirst({
		where: and(
			eq(financialAccounts.id, accountId),
			eq(financialAccounts.userId, userId),
		),
	});

	return !!conta;
}

export async function fetchOwnedAccountIds(
	userId: string,
	accountIds: Array<string | null | undefined>,
): Promise<Set<string>> {
	const ids = normalizeIds(accountIds);
	if (ids.length === 0) {
		return new Set();
	}

	const rows = await db
		.select({ id: financialAccounts.id })
		.from(financialAccounts)
		.where(
			and(
				eq(financialAccounts.userId, userId),
				inArray(financialAccounts.id, ids),
			),
		);

	return new Set(rows.map((row) => row.id));
}

export async function validateCartaoOwnership(
	userId: string,
	cardId: string | null | undefined,
): Promise<boolean> {
	if (!cardId) return true;

	const cartao = await db.query.cards.findFirst({
		where: and(eq(cards.id, cardId), eq(cards.userId, userId)),
	});

	return !!cartao;
}

export async function fetchOwnedCardIds(
	userId: string,
	cardIds: Array<string | null | undefined>,
): Promise<Set<string>> {
	const ids = normalizeIds(cardIds);
	if (ids.length === 0) {
		return new Set();
	}

	const rows = await db
		.select({ id: cards.id })
		.from(cards)
		.where(and(eq(cards.userId, userId), inArray(cards.id, ids)));

	return new Set(rows.map((row) => row.id));
}

export async function validateAllOwnership(
	userId: string,
	fields: {
		payerId?: string | null;
		secondaryPayerId?: string | null;
		splitPayerIds?: Array<string | null | undefined>;
		categoryId?: string | null;
		accountId?: string | null;
		cardId?: string | null;
	},
): Promise<string | null> {
	const payerIds = [
		fields.payerId,
		fields.secondaryPayerId,
		...(fields.splitPayerIds ?? []),
	];
	const [ownedPayerIds, ownedCategoryIds, ownedAccountIds, ownedCardIds] =
		await Promise.all([
			fetchOwnedPayerIds(userId, payerIds),
			fetchOwnedCategoryIds(userId, [fields.categoryId]),
			fetchOwnedAccountIds(userId, [fields.accountId]),
			fetchOwnedCardIds(userId, [fields.cardId]),
		]);

	const checks = [
		!fields.payerId || ownedPayerIds.has(fields.payerId),
		!fields.secondaryPayerId || ownedPayerIds.has(fields.secondaryPayerId),
		(fields.splitPayerIds ?? []).every((id) => !id || ownedPayerIds.has(id)),
		!fields.categoryId || ownedCategoryIds.has(fields.categoryId),
		!fields.accountId || ownedAccountIds.has(fields.accountId),
		!fields.cardId || ownedCardIds.has(fields.cardId),
	];

	const errors = [
		"Pessoa não encontrada ou sem permissão.",
		"Pessoa secundária não encontrada ou sem permissão.",
		"Uma das pessoas selecionadas não foi encontrada ou está sem permissão.",
		"Categoria não encontrada.",
		"Conta não encontrada.",
		"Cartão não encontrado.",
	];

	for (let i = 0; i < checks.length; i++) {
		if (!checks[i]) return errors[i];
	}
	return null;
}

// ============================================================================
// Card Limit Validation
// ============================================================================

const formatBRL = (value: number) =>
	new Intl.NumberFormat("pt-BR", {
		style: "currency",
		currency: "BRL",
	}).format(value);

export async function validateCardLimit({
	userId,
	cardId,
	addAmount,
	excludeTransactionIds = [],
}: {
	userId: string;
	cardId: string;
	addAmount: number;
	excludeTransactionIds?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
	if (addAmount <= 0) {
		return { ok: true };
	}

	const card = await db.query.cards.findFirst({
		columns: { limit: true },
		where: and(eq(cards.id, cardId), eq(cards.userId, userId)),
	});

	if (!card) {
		return { ok: false, error: "Cartão não encontrado." };
	}

	const limit = Number(card.limit);
	if (!Number.isFinite(limit) || limit <= 0) {
		return { ok: true };
	}

	const conditions = [
		eq(transactions.userId, userId),
		eq(transactions.cardId, cardId),
		or(isNull(transactions.isSettled), eq(transactions.isSettled, false)),
		or(
			ne(transactions.condition, "Recorrente"),
			sql`${transactions.purchaseDate} <= current_date`,
		),
	];

	if (excludeTransactionIds.length > 0) {
		conditions.push(not(inArray(transactions.id, excludeTransactionIds)));
	}

	const [row] = await db
		.select({
			total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
		})
		.from(transactions)
		.where(and(...conditions));

	const sumAmount = Number(row?.total ?? 0);
	const inUse = sumAmount < 0 ? Math.abs(sumAmount) : 0;
	const available = Math.max(limit - inUse, 0);

	if (addAmount > available + 0.005) {
		return {
			ok: false,
			error: `Lançamento de ${formatBRL(addAmount)} excede o limite disponível do cartão (${formatBRL(
				available,
			)}).`,
		};
	}

	return { ok: true };
}

// ============================================================================
// Utility Functions
// ============================================================================

export const resolvePeriod = (purchaseDate: string, period?: string | null) => {
	if (period && /^\d{4}-\d{2}$/.test(period)) {
		return period;
	}

	const date = parseLocalDateString(purchaseDate);
	if (Number.isNaN(date.getTime())) {
		throw new Error("Data da transação inválida.");
	}

	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	return `${year}-${month}`;
};

const isValidDateInput = (value: string) =>
	!Number.isNaN(parseLocalDateString(value).getTime());

const baseFields = z.object({
	purchaseDate: z
		.string({ message: "Informe a data da transação." })
		.trim()
		.refine((value) => isValidDateInput(value), {
			message: "Data da transação inválida.",
		}),
	period: z
		.string()
		.trim()
		.regex(/^(\d{4})-(\d{2})$/, {
			message: "Selecione um período válido.",
		})
		.optional(),
	name: z
		.string({ message: "Informe o estabelecimento." })
		.trim()
		.min(1, "Informe o estabelecimento."),
	transactionType: z
		.enum(TRANSACTION_TYPES, {
			message: "Selecione um tipo de transação válido.",
		})
		.default(TRANSACTION_TYPES[0]),
	amount: z.coerce
		.number({ message: "Informe o valor da transação." })
		.min(0, "Informe um valor maior ou igual a zero."),
	condition: z.enum(TRANSACTION_CONDITIONS, {
		message: "Selecione uma condição válida.",
	}),
	paymentMethod: z.enum(PAYMENT_METHODS, {
		message: "Selecione uma forma de pagamento válida.",
	}),
	payerId: uuidSchema("Payer").nullable().optional(),
	secondaryPayerId: uuidSchema("Payer secundário").optional(),
	splitShares: z
		.array(
			z.object({
				payerId: uuidSchema("Pessoa"),
				amount: z.coerce.number().min(0.01, "Informe um valor maior que zero."),
			}),
		)
		.optional(),
	isSplit: z.boolean().optional().default(false),
	splitMode: z
		.enum([SPLIT_MODES.COST_SHARE, SPLIT_MODES.REIMBURSEMENT])
		.optional(),
	primarySplitAmount: z.coerce.number().min(0).optional(),
	secondarySplitAmount: z.coerce.number().min(0).optional(),
	accountId: uuidSchema("FinancialAccount").nullable().optional(),
	cardId: uuidSchema("Cartão").nullable().optional(),
	categoryId: uuidSchema("Category").nullable().optional(),
	note: noteSchema,
	installmentCount: z.coerce
		.number()
		.int()
		.min(1, "Selecione uma quantidade válida.")
		.max(60, "Selecione uma quantidade válida.")
		.optional(),
	startInstallment: z.coerce
		.number()
		.int()
		.min(1, "Selecione uma parcela válida.")
		.max(60, "Selecione uma parcela válida.")
		.optional(),
	recurrenceCount: z.coerce
		.number()
		.int()
		.min(1, "Selecione uma recorrência válida.")
		.max(60, "Selecione uma recorrência válida.")
		.optional(),
	dueDate: z
		.string()
		.trim()
		.refine((value) => !value || isValidDateInput(value), {
			message: "Informe uma data de vencimento válida.",
		})
		.optional(),
	boletoPaymentDate: z
		.string()
		.trim()
		.refine((value) => !value || isValidDateInput(value), {
			message: "Informe uma data de pagamento válida.",
		})
		.optional(),
	isSettled: z.boolean().nullable().optional(),
});

const resolveRecurrenceCount = (count?: number | null) => {
	if (
		typeof count === "number" &&
		count >= 2 &&
		count <= MAX_RECURRENCE_COUNT
	) {
		return count;
	}

	return DEFAULT_RECURRENCE_COUNT;
};

const refineLancamento = (
	data: z.infer<typeof baseFields> & { id?: string },
	ctx: z.RefinementCtx,
) => {
	if (!data.categoryId) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["categoryId"],
			message: "Selecione uma categoria.",
		});
	}

	if (data.paymentMethod === "Cartão de crédito") {
		if (!data.cardId) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["cardId"],
				message: "Selecione o cartão.",
			});
		}
	} else if (!data.accountId) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["accountId"],
			message: "Selecione a conta.",
		});
	}

	if (data.condition === "Recorrente") {
		const count = resolveRecurrenceCount(data.recurrenceCount);
		if (count < 2) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["recurrenceCount"],
				message: "A recorrência deve ter ao menos dois meses.",
			});
		}
	}

	if (data.condition === "Parcelado") {
		if (!data.installmentCount) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["installmentCount"],
				message: "Informe a quantidade de parcelas.",
			});
		} else if (data.installmentCount < 2) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["installmentCount"],
				message: "Selecione pelo menos duas parcelas.",
			});
		} else if (
			data.startInstallment &&
			data.startInstallment > data.installmentCount
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["startInstallment"],
				message: "A parcela inicial não pode ser maior que o total.",
			});
		}
	}

	if (data.isSplit) {
		const isReimbursement = data.splitMode === SPLIT_MODES.REIMBURSEMENT;

		if (!data.payerId) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["payerId"],
				message: isReimbursement
					? "Selecione quem pagou o valor integral."
					: "Selecione a pessoa principal para dividir o lançamento.",
			});
		}

		if (isReimbursement) {
			if (data.transactionType !== "Despesa") {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["splitMode"],
					message:
						'O modo "Pago antecipado" só funciona com lançamentos do tipo Despesa.',
				});
			}

			const debtorShares = data.splitShares ?? [];
			if (debtorShares.length < 1) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["splitShares"],
					message: "Selecione pelo menos uma pessoa que deve reembolsar.",
				});
			}

			const uniquePayerIds = new Set(
				debtorShares.map((share) => share.payerId),
			);
			if (uniquePayerIds.size !== debtorShares.length) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["splitShares"],
					message: "Escolha pessoas diferentes para o reembolso.",
				});
			}

			if (debtorShares.some((share) => share.amount <= 0)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["splitShares"],
					message: "Informe um valor maior que zero para cada pessoa.",
				});
			}

			const sum = debtorShares.reduce(
				(total, share) => total + share.amount,
				0,
			);
			const total = Math.abs(data.amount);
			if (sum - total > 0.01) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["splitShares"],
					message:
						"A soma dos valores a receber não pode ser maior que o valor total.",
				});
			}

			return;
		}

		const shares = resolveSplitShares(data);

		if (shares.length < 2) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["splitShares"],
				message: "Selecione pelo menos uma pessoa para dividir o lançamento.",
			});
		}

		const uniquePayerIds = new Set(shares.map((share) => share.payerId));
		if (uniquePayerIds.size !== shares.length) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["splitShares"],
				message: "Escolha pessoas diferentes para dividir o lançamento.",
			});
		}

		if (shares.some((share) => share.amount <= 0)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["splitShares"],
				message: "Informe um valor maior que zero para cada pessoa.",
			});
		}

		if (shares.length > 0) {
			const sum = shares.reduce((total, share) => total + share.amount, 0);
			const total = Math.abs(data.amount);
			if (Math.abs(sum - total) > 0.01) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["splitShares"],
					message: "A soma das divisões deve ser igual ao valor total.",
				});
			}
		}
	}
};

export const createSchema = baseFields
	.extend({
		importFromTransactionId: uuidSchema("Lançamento fonte").optional(),
	})
	.superRefine(refineLancamento);
export const SERIES_EDIT_SCOPES = [
	"current",
	"period",
	"future",
	"all",
] as const;

export const updateSchema = baseFields
	.extend({
		id: uuidSchema("Lançamento"),
		seriesScope: z.enum(SERIES_EDIT_SCOPES).optional(),
	})
	.superRefine(refineLancamento);

export const deleteSchema = z.object({
	id: uuidSchema("Lançamento"),
	scope: z.enum(["current", "group"]).optional().default("current"),
});

export const toggleSettlementSchema = z.object({
	id: uuidSchema("Lançamento"),
	value: z.boolean({
		message: "Informe o status de pagamento.",
	}),
	paymentAccountId: uuidSchema("Conta de pagamento").nullable().optional(),
	paymentMethod: z.enum(PAYMENT_METHODS).optional(),
	paymentDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/u, "Data de pagamento inválida.")
		.optional(),
});

export const convertToInstallmentSchema = z.object({
	id: uuidSchema("Lançamento"),
	installmentCount: z.coerce
		.number({ message: "Informe em quantas parcelas dividir." })
		.int()
		.min(2, "O parcelamento deve ter ao menos duas parcelas.")
		.max(60, "Selecione até 60 parcelas."),
});

export const convertToRecurringSchema = z.object({
	id: uuidSchema("Lançamento"),
	recurrenceCount: z.coerce
		.number({ message: "Informe por quantos meses repetir." })
		.int()
		.min(2, "A recorrência deve ter ao menos dois meses.")
		.max(60, "Selecione até 60 meses."),
});

type BaseInput = z.infer<typeof baseFields>;
export type CreateInput = z.infer<typeof createSchema>;
export type UpdateInput = z.infer<typeof updateSchema>;
export type DeleteInput = z.infer<typeof deleteSchema>;
export type ToggleSettlementInput = z.infer<typeof toggleSettlementSchema>;
export type ConvertToInstallmentInput = z.infer<
	typeof convertToInstallmentSchema
>;
export type ConvertToRecurringInput = z.infer<typeof convertToRecurringSchema>;

export const revalidate = (userId: string) =>
	revalidateForEntity("transactions", userId);

export const resolveUserLabel = (user: {
	name?: string | null;
	email?: string | null;
}) => {
	if (user?.name && user.name.trim().length > 0) {
		return user.name;
	}
	if (user?.email && user.email.trim().length > 0) {
		return user.email;
	}
	return "OpenMonetis";
};

type InitialCandidate = {
	note: string | null;
	transactionType: string | null;
	condition: string | null;
	paymentMethod: string | null;
};

export const isInitialBalanceTransaction = (record?: InitialCandidate | null) =>
	!!record &&
	record.note === INITIAL_BALANCE_NOTE &&
	record.transactionType === INITIAL_BALANCE_TRANSACTION_TYPE &&
	record.condition === INITIAL_BALANCE_CONDITION &&
	record.paymentMethod === INITIAL_BALANCE_PAYMENT_METHOD;

export const centsToDecimalString = (value: number) => {
	const decimal = value / 100;
	const formatted = decimal.toFixed(2);
	return Object.is(decimal, -0) ? "0.00" : formatted;
};

const splitAmount = (totalCents: number, parts: number) => {
	if (parts <= 0) {
		return [];
	}

	const base = Math.trunc(totalCents / parts);
	const remainder = totalCents % parts;

	return Array.from(
		{ length: parts },
		(_, index) => base + (index < remainder ? 1 : 0),
	);
};

type Share = {
	payerId: string | null;
	amountCents: number;
};

type SplitShareInput = {
	payerId: string;
	amount: number;
};

const resolveSplitShares = (data: {
	payerId?: string | null;
	secondaryPayerId?: string | null;
	splitShares?: SplitShareInput[];
	primarySplitAmount?: number;
	secondarySplitAmount?: number;
}): SplitShareInput[] => {
	if (data.splitShares && data.splitShares.length > 0) {
		return data.splitShares;
	}

	if (!data.payerId || !data.secondaryPayerId) {
		return [];
	}

	return [
		{ payerId: data.payerId, amount: data.primarySplitAmount ?? 0 },
		{
			payerId: data.secondaryPayerId,
			amount: data.secondarySplitAmount ?? 0,
		},
	];
};

export const buildShares = ({
	totalCents,
	payerId,
	isSplit,
	secondaryPayerId,
	splitShares,
	primarySplitAmountCents,
	secondarySplitAmountCents,
}: {
	totalCents: number;
	payerId: string | null;
	isSplit: boolean;
	secondaryPayerId?: string;
	splitShares?: SplitShareInput[];
	primarySplitAmountCents?: number;
	secondarySplitAmountCents?: number;
}): Share[] => {
	if (isSplit) {
		if (splitShares && splitShares.length > 0) {
			return splitShares.map((share) => ({
				payerId: share.payerId,
				amountCents: Math.round(share.amount * 100),
			}));
		}

		if (!payerId || !secondaryPayerId) {
			throw new Error("Configuração de divisão inválida para o lançamento.");
		}

		if (
			primarySplitAmountCents !== undefined &&
			secondarySplitAmountCents !== undefined
		) {
			return [
				{ payerId, amountCents: primarySplitAmountCents },
				{
					payerId: secondaryPayerId,
					amountCents: secondarySplitAmountCents,
				},
			];
		}

		const [primaryAmount, secondaryAmount] = splitAmount(totalCents, 2);
		return [
			{ payerId, amountCents: primaryAmount },
			{ payerId: secondaryPayerId, amountCents: secondaryAmount },
		];
	}

	return [{ payerId, amountCents: totalCents }];
};

type BuildTransactionRecordsParams = {
	data: BaseInput;
	userId: string;
	period: string;
	purchaseDate: Date;
	dueDate: Date | null;
	boletoPaymentDate: Date | null;
	shares: Share[];
	amountSign: 1 | -1;
	shouldNullifySettled: boolean;
	seriesId: string | null;
};

export type TransactionInsert = typeof transactions.$inferInsert;

export const buildTransactionRecords = ({
	data,
	userId,
	period,
	purchaseDate,
	dueDate,
	boletoPaymentDate,
	shares,
	amountSign,
	shouldNullifySettled,
	seriesId,
}: BuildTransactionRecordsParams): TransactionInsert[] => {
	const records: TransactionInsert[] = [];
	const isSplit = (data.isSplit ?? false) && shares.length > 1;

	const basePayload = {
		name: data.name,
		transactionType: data.transactionType,
		condition: data.condition,
		paymentMethod: data.paymentMethod,
		note: data.note ?? null,
		accountId: data.accountId ?? null,
		cardId: data.cardId ?? null,
		categoryId: data.categoryId ?? null,
		recurrenceCount: null as number | null,
		installmentCount: null as number | null,
		currentInstallment: null as number | null,
		isDivided: data.isSplit ?? false,
		splitMode: isSplit ? SPLIT_MODES.COST_SHARE : null,
		reimbursementDebtorId: null,
		userId,
		seriesId,
	};

	const cycleSplitGroupId = () => (isSplit ? randomUUID() : null);

	const resolveSettledValue = (cycleIndex: number) => {
		if (shouldNullifySettled) {
			return null;
		}
		const initialSettled = data.isSettled ?? false;
		if (data.condition === "Parcelado" || data.condition === "Recorrente") {
			return cycleIndex === 0 ? initialSettled : false;
		}
		return initialSettled;
	};

	if (data.condition === "Parcelado") {
		const installmentTotal = data.installmentCount ?? 0;
		const startInstallment = data.startInstallment ?? 1;
		const amountsByShare = shares.map((share) =>
			splitAmount(share.amountCents, installmentTotal),
		);

		for (
			let index = 0;
			index <= installmentTotal - startInstallment;
			index += 1
		) {
			const currentInstallment = startInstallment + index;
			const installmentPeriod = addMonthsToPeriod(period, index);
			const installmentDueDate = dueDate
				? addMonthsToDate(dueDate, index)
				: null;
			const splitGroupId = cycleSplitGroupId();

			shares.forEach((share, shareIndex) => {
				const amountCents =
					amountsByShare[shareIndex]?.[currentInstallment - 1] ?? 0;
				const settled = resolveSettledValue(index);
				records.push({
					...basePayload,
					amount: centsToDecimalString(amountCents * amountSign),
					payerId: share.payerId,
					purchaseDate,
					period: installmentPeriod,
					isSettled: settled,
					installmentCount: installmentTotal,
					currentInstallment,
					recurrenceCount: null,
					dueDate: installmentDueDate,
					splitGroupId,
					boletoPaymentDate:
						data.paymentMethod === "Boleto" && settled
							? boletoPaymentDate
							: null,
				});
			});
		}

		return records;
	}

	if (data.condition === "Recorrente") {
		const recurrenceTotal = resolveRecurrenceCount(data.recurrenceCount);

		for (let index = 0; index < recurrenceTotal; index += 1) {
			const recurrencePeriod = addMonthsToPeriod(period, index);
			const recurrencePurchaseDate = addMonthsToDate(purchaseDate, index);
			const recurrenceDueDate = dueDate
				? addMonthsToDate(dueDate, index)
				: null;
			const splitGroupId = cycleSplitGroupId();

			shares.forEach((share) => {
				const settled = resolveSettledValue(index);
				records.push({
					...basePayload,
					amount: centsToDecimalString(share.amountCents * amountSign),
					payerId: share.payerId,
					purchaseDate: recurrencePurchaseDate,
					period: recurrencePeriod,
					isSettled: settled,
					recurrenceCount: recurrenceTotal,
					dueDate: recurrenceDueDate,
					splitGroupId,
					boletoPaymentDate:
						data.paymentMethod === "Boleto" && settled
							? boletoPaymentDate
							: null,
				});
			});
		}

		return records;
	}

	const splitGroupId = cycleSplitGroupId();

	shares.forEach((share) => {
		const settled = resolveSettledValue(0);
		records.push({
			...basePayload,
			amount: centsToDecimalString(share.amountCents * amountSign),
			payerId: share.payerId,
			purchaseDate,
			period,
			isSettled: settled,
			dueDate,
			splitGroupId,
			boletoPaymentDate:
				data.paymentMethod === "Boleto" && settled ? boletoPaymentDate : null,
		});
	});

	return records;
};

const REIMBURSEMENT_PAYMENT_METHOD = DEFAULT_RECEIVABLE_PAYMENT_METHOD;

/**
 * Conta destino das receitas "a receber".
 * Em cartão a despesa não tem accountId — usamos a conta vinculada ao cartão.
 */
export async function resolveReceivableAccountId({
	userId,
	accountId,
	cardId,
}: {
	userId: string;
	accountId?: string | null;
	cardId?: string | null;
}): Promise<string | null> {
	if (accountId) {
		return accountId;
	}

	if (!cardId) {
		return null;
	}

	const card = await db.query.cards.findFirst({
		columns: { accountId: true },
		where: and(eq(cards.id, cardId), eq(cards.userId, userId)),
	});

	return card?.accountId ?? null;
}

type BuildReimbursementRecordsParams = {
	data: BaseInput;
	userId: string;
	period: string;
	purchaseDate: Date;
	dueDate: Date | null;
	boletoPaymentDate: Date | null;
	debtorShares: Share[];
	totalCents: number;
	shouldNullifySettled: boolean;
	seriesId: string | null;
	receivableCategoryId: string;
	receivableAccountId?: string | null;
};

export const buildDebtorShares = (splitShares?: SplitShareInput[]): Share[] => {
	if (!splitShares?.length) {
		return [];
	}

	return splitShares.map((share) => ({
		payerId: share.payerId,
		amountCents: Math.round(share.amount * 100),
	}));
};

export const buildReimbursementRecords = ({
	data,
	userId,
	period,
	purchaseDate,
	dueDate,
	boletoPaymentDate,
	debtorShares,
	totalCents,
	shouldNullifySettled,
	seriesId,
	receivableCategoryId,
	receivableAccountId,
}: BuildReimbursementRecordsParams): TransactionInsert[] => {
	const records: TransactionInsert[] = [];
	const payerId = data.payerId;
	if (!payerId) {
		throw new Error("Pessoa principal não informada para o reembolso.");
	}

	const expenseBasePayload = {
		name: data.name,
		transactionType: data.transactionType,
		condition: data.condition,
		paymentMethod: data.paymentMethod,
		note: data.note ?? null,
		accountId: data.accountId ?? null,
		cardId: data.cardId ?? null,
		categoryId: data.categoryId ?? null,
		payerId,
		isDivided: true,
		splitMode: SPLIT_MODES.REIMBURSEMENT,
		reimbursementDebtorId: null,
		userId,
		seriesId,
	};

	const receivableBasePayload = {
		name: data.name,
		transactionType: "Receita" as const,
		condition: data.condition,
		paymentMethod: REIMBURSEMENT_PAYMENT_METHOD,
		note: data.note ?? null,
		accountId: receivableAccountId ?? data.accountId ?? null,
		cardId: null,
		categoryId: receivableCategoryId,
		payerId,
		isDivided: true,
		splitMode: SPLIT_MODES.REIMBURSEMENT,
		userId,
		seriesId,
	};

	const cycleSplitGroupId = () => randomUUID();

	const resolveExpenseSettledValue = (cycleIndex: number) => {
		if (shouldNullifySettled) {
			return null;
		}
		const initialSettled = data.isSettled ?? false;
		if (data.condition === "Parcelado" || data.condition === "Recorrente") {
			return cycleIndex === 0 ? initialSettled : false;
		}
		return initialSettled;
	};

	const pushReceivableRecords = ({
		splitGroupId,
		cycleDebtorShares,
		cyclePurchaseDate,
		cyclePeriod,
		cycleDueDate,
		installmentCount,
		currentInstallment,
		recurrenceCount,
	}: {
		splitGroupId: string;
		cycleDebtorShares: Share[];
		cyclePurchaseDate: Date;
		cyclePeriod: string;
		cycleDueDate: Date | null;
		installmentCount: number | null;
		currentInstallment: number | null;
		recurrenceCount: number | null;
	}) => {
		for (const share of cycleDebtorShares) {
			if (share.amountCents <= 0) {
				continue;
			}

			records.push({
				...receivableBasePayload,
				amount: centsToDecimalString(share.amountCents),
				purchaseDate: cyclePurchaseDate,
				period: cyclePeriod,
				isSettled: false,
				dueDate: cycleDueDate,
				boletoPaymentDate: null,
				splitGroupId,
				reimbursementDebtorId: share.payerId,
				installmentCount,
				currentInstallment,
				recurrenceCount,
			});
		}
	};

	if (data.condition === "Parcelado") {
		const installmentTotal = data.installmentCount ?? 0;
		const startInstallment = data.startInstallment ?? 1;
		const expenseAmountsByCycle = splitAmount(totalCents, installmentTotal);
		const debtorAmountsByShare = debtorShares.map((share) =>
			splitAmount(share.amountCents, installmentTotal),
		);

		for (
			let index = 0;
			index <= installmentTotal - startInstallment;
			index += 1
		) {
			const currentInstallment = startInstallment + index;
			const installmentPeriod = addMonthsToPeriod(period, index);
			const installmentDueDate = dueDate
				? addMonthsToDate(dueDate, index)
				: null;
			const splitGroupId = cycleSplitGroupId();
			const expenseAmountCents =
				expenseAmountsByCycle[currentInstallment - 1] ?? 0;
			const settled = resolveExpenseSettledValue(index);

			records.push({
				...expenseBasePayload,
				amount: centsToDecimalString(expenseAmountCents * -1),
				purchaseDate,
				period: installmentPeriod,
				isSettled: settled,
				installmentCount: installmentTotal,
				currentInstallment,
				recurrenceCount: null,
				dueDate: installmentDueDate,
				splitGroupId,
				boletoPaymentDate:
					data.paymentMethod === "Boleto" && settled ? boletoPaymentDate : null,
			});

			const cycleDebtorShares = debtorShares.map((share, shareIndex) => ({
				payerId: share.payerId,
				amountCents:
					debtorAmountsByShare[shareIndex]?.[currentInstallment - 1] ?? 0,
			}));

			pushReceivableRecords({
				splitGroupId,
				cycleDebtorShares,
				cyclePurchaseDate: purchaseDate,
				cyclePeriod: installmentPeriod,
				cycleDueDate: installmentDueDate,
				installmentCount: installmentTotal,
				currentInstallment,
				recurrenceCount: null,
			});
		}

		return records;
	}

	if (data.condition === "Recorrente") {
		const recurrenceTotal = resolveRecurrenceCount(data.recurrenceCount);

		for (let index = 0; index < recurrenceTotal; index += 1) {
			const recurrencePeriod = addMonthsToPeriod(period, index);
			const recurrencePurchaseDate = addMonthsToDate(purchaseDate, index);
			const recurrenceDueDate = dueDate
				? addMonthsToDate(dueDate, index)
				: null;
			const splitGroupId = cycleSplitGroupId();
			const settled = resolveExpenseSettledValue(index);

			records.push({
				...expenseBasePayload,
				amount: centsToDecimalString(totalCents * -1),
				purchaseDate: recurrencePurchaseDate,
				period: recurrencePeriod,
				isSettled: settled,
				recurrenceCount: recurrenceTotal,
				installmentCount: null,
				currentInstallment: null,
				dueDate: recurrenceDueDate,
				splitGroupId,
				boletoPaymentDate:
					data.paymentMethod === "Boleto" && settled ? boletoPaymentDate : null,
			});

			pushReceivableRecords({
				splitGroupId,
				cycleDebtorShares: debtorShares,
				cyclePurchaseDate: recurrencePurchaseDate,
				cyclePeriod: recurrencePeriod,
				cycleDueDate: recurrenceDueDate,
				installmentCount: null,
				currentInstallment: null,
				recurrenceCount: recurrenceTotal,
			});
		}

		return records;
	}

	const splitGroupId = cycleSplitGroupId();
	const settled = resolveExpenseSettledValue(0);

	records.push({
		...expenseBasePayload,
		amount: centsToDecimalString(totalCents * -1),
		purchaseDate,
		period,
		isSettled: settled,
		installmentCount: null,
		currentInstallment: null,
		recurrenceCount: null,
		dueDate,
		splitGroupId,
		boletoPaymentDate:
			data.paymentMethod === "Boleto" && settled ? boletoPaymentDate : null,
	});

	pushReceivableRecords({
		splitGroupId,
		cycleDebtorShares: debtorShares,
		cyclePurchaseDate: purchaseDate,
		cyclePeriod: period,
		cycleDueDate: dueDate,
		installmentCount: null,
		currentInstallment: null,
		recurrenceCount: null,
	});

	return records;
};

type SyncReimbursementParams = {
	userId: string;
	expenseId: string;
	splitGroupId: string | null;
	data: BaseInput;
	period: string;
	purchaseDate: Date;
	dueDate: Date | null;
	boletoPaymentDate: Date | null;
	totalCents: number;
	shouldNullifySettled: boolean;
	receivableCategoryId: string;
	receivableAccountId?: string | null;
	existingSeriesId: string | null;
	existingInstallmentCount: number | null;
	existingCurrentInstallment: number | null;
	existingRecurrenceCount: number | null;
};

/**
 * Updates the expense row and syncs receivable siblings for a reimbursement split.
 * Creates missing debtors, updates amounts, deletes unsettled orphans.
 * Returns an error message when a settled receivable would be removed.
 */
export async function syncReimbursementSplitGroup({
	userId,
	expenseId,
	splitGroupId: existingSplitGroupId,
	data,
	period,
	purchaseDate,
	dueDate,
	boletoPaymentDate,
	totalCents,
	shouldNullifySettled,
	receivableCategoryId,
	receivableAccountId,
	existingSeriesId,
	existingInstallmentCount,
	existingCurrentInstallment,
	existingRecurrenceCount,
}: SyncReimbursementParams): Promise<{ error?: string }> {
	const payerId = data.payerId;
	if (!payerId) {
		return { error: "Selecione quem pagou o valor integral." };
	}

	const debtorShares = buildDebtorShares(data.splitShares);
	if (debtorShares.length < 1) {
		return { error: "Selecione pelo menos uma pessoa que deve reembolsar." };
	}

	const splitGroupId = existingSplitGroupId ?? randomUUID();
	const settled = shouldNullifySettled ? null : (data.isSettled ?? false);
	const installmentCount =
		data.condition === "Parcelado"
			? (data.installmentCount ?? existingInstallmentCount)
			: null;
	const currentInstallment =
		data.condition === "Parcelado" ? existingCurrentInstallment : null;
	const recurrenceCount =
		data.condition === "Recorrente"
			? (data.recurrenceCount ?? existingRecurrenceCount)
			: null;

	const resolvedReceivableAccountId =
		receivableAccountId ??
		(await resolveReceivableAccountId({
			userId,
			accountId: data.accountId,
			cardId: data.cardId,
		}));

	const expensePayload = {
		name: data.name,
		purchaseDate,
		period,
		transactionType: data.transactionType,
		amount: centsToDecimalString(totalCents * -1),
		condition: data.condition,
		paymentMethod: data.paymentMethod,
		note: data.note ?? null,
		accountId: data.accountId ?? null,
		cardId: data.cardId ?? null,
		categoryId: data.categoryId ?? null,
		payerId,
		isSettled: settled,
		dueDate,
		boletoPaymentDate:
			data.paymentMethod === "Boleto" && settled ? boletoPaymentDate : null,
		installmentCount,
		currentInstallment,
		recurrenceCount,
		isDivided: true,
		splitMode: SPLIT_MODES.REIMBURSEMENT,
		reimbursementDebtorId: null,
		splitGroupId,
	};

	const receivableShared = {
		name: data.name,
		purchaseDate,
		period,
		transactionType: "Receita" as const,
		condition: data.condition,
		paymentMethod: REIMBURSEMENT_PAYMENT_METHOD,
		note: data.note ?? null,
		accountId: resolvedReceivableAccountId,
		cardId: null as string | null,
		categoryId: receivableCategoryId,
		payerId,
		dueDate,
		boletoPaymentDate: null as Date | null,
		installmentCount,
		currentInstallment,
		recurrenceCount,
		isDivided: true,
		splitMode: SPLIT_MODES.REIMBURSEMENT,
		splitGroupId,
		seriesId: existingSeriesId,
	};

	const existingReceivables = existingSplitGroupId
		? await db.query.transactions.findMany({
				columns: {
					id: true,
					reimbursementDebtorId: true,
					isSettled: true,
					amount: true,
				},
				where: and(
					eq(transactions.userId, userId),
					eq(transactions.splitGroupId, existingSplitGroupId),
					ne(transactions.id, expenseId),
				),
			})
		: [];

	const desiredDebtorIds = new Set(debtorShares.map((s) => s.payerId));
	const byDebtor = new Map(
		existingReceivables
			.filter((r) => r.reimbursementDebtorId)
			.map((r) => [r.reimbursementDebtorId as string, r]),
	);

	for (const existing of existingReceivables) {
		const debtorId = existing.reimbursementDebtorId;
		if (debtorId && !desiredDebtorIds.has(debtorId)) {
			if (existing.isSettled) {
				return {
					error:
						"Não é possível remover uma pessoa cujo valor a receber já foi marcado como recebido.",
				};
			}
		}
	}

	await db.transaction(async (tx) => {
		await tx
			.update(transactions)
			.set(expensePayload)
			.where(
				and(eq(transactions.id, expenseId), eq(transactions.userId, userId)),
			);

		for (const share of debtorShares) {
			if (!share.payerId || share.amountCents <= 0) continue;

			const existing = byDebtor.get(share.payerId);
			if (existing) {
				await tx
					.update(transactions)
					.set({
						...receivableShared,
						amount: centsToDecimalString(share.amountCents),
						reimbursementDebtorId: share.payerId,
						// Keep settlement status on existing receivables
						isSettled: existing.isSettled ?? false,
					})
					.where(
						and(
							eq(transactions.id, existing.id),
							eq(transactions.userId, userId),
						),
					);
			} else {
				await tx.insert(transactions).values({
					...receivableShared,
					amount: centsToDecimalString(share.amountCents),
					reimbursementDebtorId: share.payerId,
					isSettled: false,
					userId,
				});
			}
		}

		for (const existing of existingReceivables) {
			const debtorId = existing.reimbursementDebtorId;
			if (!debtorId || desiredDebtorIds.has(debtorId)) continue;
			if (existing.isSettled) continue;

			await tx
				.delete(transactions)
				.where(
					and(
						eq(transactions.id, existing.id),
						eq(transactions.userId, userId),
					),
				);
		}
	});

	return {};
}

type SeriesExpenseCycle = {
	id: string;
	period: string;
	purchaseDate: Date;
	dueDate: Date | null;
	splitGroupId: string | null;
	installmentCount: number | null;
	currentInstallment: number | null;
	recurrenceCount: number | null;
	seriesId: string | null;
};

async function fetchSeriesExpenseCycles({
	userId,
	seriesId,
	anchorPeriod,
	scope,
}: {
	userId: string;
	seriesId: string;
	anchorPeriod: string;
	scope: (typeof SERIES_EDIT_SCOPES)[number];
}): Promise<SeriesExpenseCycle[]> {
	const scopeFilter =
		scope === "current" || scope === "period"
			? eq(transactions.period, anchorPeriod)
			: scope === "future"
				? sql`${transactions.period} >= ${anchorPeriod}`
				: undefined;

	const rows = await db.query.transactions.findMany({
		columns: {
			id: true,
			period: true,
			purchaseDate: true,
			dueDate: true,
			splitGroupId: true,
			installmentCount: true,
			currentInstallment: true,
			recurrenceCount: true,
			seriesId: true,
		},
		where: and(
			eq(transactions.userId, userId),
			eq(transactions.seriesId, seriesId),
			eq(transactions.transactionType, "Despesa"),
			isNull(transactions.reimbursementDebtorId),
			scopeFilter,
		),
		orderBy: [asc(transactions.period)],
	});

	return rows.map((row) => ({
		id: row.id,
		period: row.period,
		purchaseDate: row.purchaseDate,
		dueDate: row.dueDate,
		splitGroupId: row.splitGroupId,
		installmentCount: row.installmentCount,
		currentInstallment: row.currentInstallment,
		recurrenceCount: row.recurrenceCount,
		seriesId: row.seriesId,
	}));
}

/**
 * Applies reimbursement split sync across expense cycles of a series.
 * Each cycle keeps its own purchaseDate/period; shared fields and receivables
 * are created/updated per cycle.
 */
export async function syncReimbursementSeries({
	userId,
	seriesId,
	anchorExpenseId,
	anchorPeriod,
	scope,
	data,
	boletoPaymentDate,
	totalCents,
	shouldNullifySettled,
	receivableCategoryId,
	receivableAccountId,
}: {
	userId: string;
	seriesId: string;
	anchorExpenseId: string;
	anchorPeriod: string;
	scope: (typeof SERIES_EDIT_SCOPES)[number];
	data: BaseInput;
	boletoPaymentDate: Date | null;
	totalCents: number;
	shouldNullifySettled: boolean;
	receivableCategoryId: string;
	receivableAccountId?: string | null;
}): Promise<{ error?: string; updatedCount: number }> {
	const cycles = await fetchSeriesExpenseCycles({
		userId,
		seriesId,
		anchorPeriod,
		scope,
	});

	if (cycles.length === 0) {
		return { error: "Nenhum lançamento da série encontrado.", updatedCount: 0 };
	}

	// Ensure the edited expense is included even if filters missed it
	if (!cycles.some((cycle) => cycle.id === anchorExpenseId)) {
		const anchor = await db.query.transactions.findFirst({
			columns: {
				id: true,
				period: true,
				purchaseDate: true,
				dueDate: true,
				splitGroupId: true,
				installmentCount: true,
				currentInstallment: true,
				recurrenceCount: true,
				seriesId: true,
			},
			where: and(
				eq(transactions.id, anchorExpenseId),
				eq(transactions.userId, userId),
			),
		});
		if (anchor) {
			cycles.unshift({
				id: anchor.id,
				period: anchor.period,
				purchaseDate: anchor.purchaseDate,
				dueDate: anchor.dueDate,
				splitGroupId: anchor.splitGroupId,
				installmentCount: anchor.installmentCount,
				currentInstallment: anchor.currentInstallment,
				recurrenceCount: anchor.recurrenceCount,
				seriesId: anchor.seriesId,
			});
		}
	}

	for (const cycle of cycles) {
		const isAnchor = cycle.id === anchorExpenseId;
		const cycleData: BaseInput = {
			...data,
			// Keep each cycle on its own calendar month unless editing the anchor
			purchaseDate: isAnchor
				? data.purchaseDate
				: cycle.purchaseDate.toISOString().slice(0, 10),
			period: isAnchor ? data.period : cycle.period,
			dueDate: isAnchor
				? data.dueDate
				: cycle.dueDate
					? cycle.dueDate.toISOString().slice(0, 10)
					: undefined,
			installmentCount: cycle.installmentCount ?? data.installmentCount,
			recurrenceCount: cycle.recurrenceCount ?? data.recurrenceCount,
		};

		const result = await syncReimbursementSplitGroup({
			userId,
			expenseId: cycle.id,
			splitGroupId: cycle.splitGroupId,
			data: cycleData,
			period: isAnchor ? (data.period ?? cycle.period) : cycle.period,
			purchaseDate: isAnchor
				? parseLocalDateString(data.purchaseDate)
				: cycle.purchaseDate,
			dueDate: isAnchor
				? data.dueDate
					? parseLocalDateString(data.dueDate)
					: null
				: cycle.dueDate,
			boletoPaymentDate: isAnchor ? boletoPaymentDate : null,
			totalCents,
			shouldNullifySettled,
			receivableCategoryId,
			receivableAccountId,
			existingSeriesId: seriesId,
			existingInstallmentCount: cycle.installmentCount,
			existingCurrentInstallment: cycle.currentInstallment,
			existingRecurrenceCount: cycle.recurrenceCount,
		});

		if (result.error) {
			return { error: result.error, updatedCount: 0 };
		}
	}

	return { updatedCount: cycles.length };
}

/**
 * Dissolves reimbursement splits across expense cycles of a series.
 */
export async function dissolveReimbursementSeries({
	userId,
	seriesId,
	anchorExpenseId,
	anchorPeriod,
	scope,
}: {
	userId: string;
	seriesId: string;
	anchorExpenseId: string;
	anchorPeriod: string;
	scope: (typeof SERIES_EDIT_SCOPES)[number];
}): Promise<{ error?: string; updatedCount: number }> {
	const cycles = await fetchSeriesExpenseCycles({
		userId,
		seriesId,
		anchorPeriod,
		scope,
	});

	if (cycles.length === 0) {
		return { error: "Nenhum lançamento da série encontrado.", updatedCount: 0 };
	}

	if (!cycles.some((cycle) => cycle.id === anchorExpenseId)) {
		const anchor = await db.query.transactions.findFirst({
			columns: {
				id: true,
				period: true,
				purchaseDate: true,
				dueDate: true,
				splitGroupId: true,
				installmentCount: true,
				currentInstallment: true,
				recurrenceCount: true,
				seriesId: true,
			},
			where: and(
				eq(transactions.id, anchorExpenseId),
				eq(transactions.userId, userId),
			),
		});
		if (anchor) {
			cycles.unshift({
				id: anchor.id,
				period: anchor.period,
				purchaseDate: anchor.purchaseDate,
				dueDate: anchor.dueDate,
				splitGroupId: anchor.splitGroupId,
				installmentCount: anchor.installmentCount,
				currentInstallment: anchor.currentInstallment,
				recurrenceCount: anchor.recurrenceCount,
				seriesId: anchor.seriesId,
			});
		}
	}

	let updatedCount = 0;
	for (const cycle of cycles) {
		if (!cycle.splitGroupId) {
			await db
				.update(transactions)
				.set({
					isDivided: false,
					splitMode: null,
					splitGroupId: null,
					reimbursementDebtorId: null,
				})
				.where(
					and(eq(transactions.id, cycle.id), eq(transactions.userId, userId)),
				);
			updatedCount += 1;
			continue;
		}

		const result = await dissolveReimbursementSplitGroup({
			userId,
			expenseId: cycle.id,
			splitGroupId: cycle.splitGroupId,
		});
		if (result.error) {
			return { error: result.error, updatedCount };
		}
		updatedCount += 1;
	}

	return { updatedCount };
}

/**
 * Dissolves a reimbursement group: keeps the expense as a normal transaction
 * and deletes unsettled receivables. Fails if any receivable is already settled.
 */
export async function dissolveReimbursementSplitGroup({
	userId,
	expenseId,
	splitGroupId,
}: {
	userId: string;
	expenseId: string;
	splitGroupId: string;
}): Promise<{ error?: string }> {
	const siblings = await db.query.transactions.findMany({
		columns: {
			id: true,
			reimbursementDebtorId: true,
			isSettled: true,
		},
		where: and(
			eq(transactions.userId, userId),
			eq(transactions.splitGroupId, splitGroupId),
			ne(transactions.id, expenseId),
		),
	});

	const settledReceivable = siblings.find(
		(s) => s.reimbursementDebtorId && s.isSettled,
	);
	if (settledReceivable) {
		return {
			error:
				"Não é possível remover a divisão: há valores a receber já marcados como recebidos.",
		};
	}

	await db.transaction(async (tx) => {
		if (siblings.length > 0) {
			await tx
				.delete(transactions)
				.where(
					and(
						eq(transactions.userId, userId),
						eq(transactions.splitGroupId, splitGroupId),
						ne(transactions.id, expenseId),
					),
				);
		}

		await tx
			.update(transactions)
			.set({
				isDivided: false,
				splitMode: null,
				splitGroupId: null,
				reimbursementDebtorId: null,
			})
			.where(
				and(eq(transactions.id, expenseId), eq(transactions.userId, userId)),
			);
	});

	return {};
}

type SyncCostShareParams = {
	userId: string;
	anchorId: string;
	splitGroupId: string | null;
	data: BaseInput;
	period: string;
	purchaseDate: Date;
	dueDate: Date | null;
	boletoPaymentDate: Date | null;
	amountSign: 1 | -1;
	shouldNullifySettled: boolean;
	existingSeriesId: string | null;
	existingInstallmentCount: number | null;
	existingCurrentInstallment: number | null;
	existingRecurrenceCount: number | null;
};

/**
 * Syncs a cost_share split group: updates all member amounts/payers and
 * shared metadata. Creates new shares and deletes removed ones.
 */
export async function syncCostShareSplitGroup({
	userId,
	anchorId,
	splitGroupId: existingSplitGroupId,
	data,
	period,
	purchaseDate,
	dueDate,
	boletoPaymentDate,
	amountSign,
	shouldNullifySettled,
	existingSeriesId,
	existingInstallmentCount,
	existingCurrentInstallment,
	existingRecurrenceCount,
}: SyncCostShareParams): Promise<{ error?: string }> {
	const totalCents = Math.round(Math.abs(data.amount) * 100);
	const shares = buildShares({
		totalCents,
		payerId: data.payerId ?? null,
		isSplit: true,
		secondaryPayerId: data.secondaryPayerId,
		splitShares: data.splitShares,
		primarySplitAmountCents: data.primarySplitAmount
			? Math.round(data.primarySplitAmount * 100)
			: undefined,
		secondarySplitAmountCents: data.secondarySplitAmount
			? Math.round(data.secondarySplitAmount * 100)
			: undefined,
	});

	if (shares.length < 2) {
		return {
			error: "Selecione pelo menos uma pessoa para dividir o lançamento.",
		};
	}

	const splitGroupId = existingSplitGroupId ?? randomUUID();
	const settled = shouldNullifySettled ? null : (data.isSettled ?? false);
	const installmentCount =
		data.condition === "Parcelado"
			? (data.installmentCount ?? existingInstallmentCount)
			: null;
	const currentInstallment =
		data.condition === "Parcelado" ? existingCurrentInstallment : null;
	const recurrenceCount =
		data.condition === "Recorrente"
			? (data.recurrenceCount ?? existingRecurrenceCount)
			: null;

	const sharedPayload = {
		name: data.name,
		purchaseDate,
		period,
		transactionType: data.transactionType,
		condition: data.condition,
		paymentMethod: data.paymentMethod,
		note: data.note ?? null,
		accountId: data.accountId ?? null,
		cardId: data.cardId ?? null,
		categoryId: data.categoryId ?? null,
		dueDate,
		boletoPaymentDate:
			data.paymentMethod === "Boleto" && settled ? boletoPaymentDate : null,
		isSettled: settled,
		installmentCount,
		currentInstallment,
		recurrenceCount,
		isDivided: true,
		splitMode: SPLIT_MODES.COST_SHARE,
		reimbursementDebtorId: null,
		splitGroupId,
		seriesId: existingSeriesId,
	};

	const existingMembers = existingSplitGroupId
		? await db.query.transactions.findMany({
				columns: {
					id: true,
					payerId: true,
					isSettled: true,
				},
				where: and(
					eq(transactions.userId, userId),
					eq(transactions.splitGroupId, existingSplitGroupId),
				),
			})
		: [{ id: anchorId, payerId: data.payerId ?? null, isSettled: settled }];

	const byPayer = new Map(
		existingMembers
			.filter((m) => m.payerId)
			.map((m) => [m.payerId as string, m]),
	);
	const desiredPayerIds = new Set(
		shares.map((s) => s.payerId).filter((id): id is string => Boolean(id)),
	);

	for (const member of existingMembers) {
		if (member.payerId && !desiredPayerIds.has(member.payerId)) {
			if (member.isSettled) {
				return {
					error:
						"Não é possível remover uma pessoa cujo lançamento já está pago.",
				};
			}
		}
	}

	await db.transaction(async (tx) => {
		const matchedIds = new Set<string>();

		for (const share of shares) {
			if (!share.payerId || share.amountCents <= 0) continue;

			const existing = byPayer.get(share.payerId);
			if (existing && !matchedIds.has(existing.id)) {
				matchedIds.add(existing.id);
				await tx
					.update(transactions)
					.set({
						...sharedPayload,
						amount: centsToDecimalString(share.amountCents * amountSign),
						payerId: share.payerId,
						isSettled: existing.isSettled ?? settled,
					})
					.where(
						and(
							eq(transactions.id, existing.id),
							eq(transactions.userId, userId),
						),
					);
			} else {
				await tx.insert(transactions).values({
					...sharedPayload,
					amount: centsToDecimalString(share.amountCents * amountSign),
					payerId: share.payerId,
					isSettled: settled,
					userId,
				});
			}
		}

		for (const member of existingMembers) {
			if (matchedIds.has(member.id)) continue;
			if (member.isSettled) continue;

			await tx
				.delete(transactions)
				.where(
					and(eq(transactions.id, member.id), eq(transactions.userId, userId)),
				);
		}
	});

	return {};
}

export const formatPaidInvoicePeriods = (periods: string[]) =>
	periods
		.map((period) => {
			const [year, month] = period.split("-");
			const monthName = MONTH_NAMES[Number(month) - 1] ?? month;
			return `${monthName}/${year}`;
		})
		.join(", ");

export async function getPaidInvoicePeriods(
	userId: string,
	cardId: string,
	periods: string[],
) {
	if (periods.length === 0) {
		return [];
	}

	const rows = await db.query.invoices.findMany({
		columns: { period: true },
		where: and(
			eq(invoices.userId, userId),
			eq(invoices.cardId, cardId),
			eq(invoices.paymentStatus, INVOICE_PAYMENT_STATUS.PAID),
			inArray(invoices.period, periods),
		),
	});

	return [
		...new Set(
			rows
				.map((row) => row.period)
				.filter((period): period is string => Boolean(period)),
		),
	];
}

export const deleteBulkSchema = z.object({
	id: uuidSchema("Lançamento"),
	scope: z.enum(["current", "period", "future", "all"], {
		message: "Escopo de ação inválido.",
	}),
});

export type DeleteBulkInput = z.infer<typeof deleteBulkSchema>;

export const updateBulkSchema = z.object({
	id: uuidSchema("Lançamento"),
	scope: z.enum(["current", "period", "future", "all"], {
		message: "Escopo de ação inválido.",
	}),
	purchaseDate: z
		.string()
		.trim()
		.refine((value) => !value || isValidDateInput(value), {
			message: "Data da transação inválida.",
		})
		.optional(),
	period: z
		.string()
		.trim()
		.regex(/^(\d{4})-(\d{2})$/, {
			message: "Selecione um período válido.",
		})
		.optional(),
	name: z
		.string({ message: "Informe o estabelecimento." })
		.trim()
		.min(1, "Informe o estabelecimento."),
	categoryId: uuidSchema("Category").nullable().optional(),
	note: noteSchema,
	payerId: uuidSchema("Payer").nullable().optional(),
	accountId: uuidSchema("FinancialAccount").nullable().optional(),
	cardId: uuidSchema("Cartão").nullable().optional(),
	amount: z.coerce
		.number({ message: "Informe o valor da transação." })
		.min(0, "Informe um valor maior ou igual a zero.")
		.optional(),
	dueDate: z
		.string()
		.trim()
		.refine((value) => !value || isValidDateInput(value), {
			message: "Informe uma data de vencimento válida.",
		})
		.optional()
		.nullable(),
	boletoPaymentDate: z
		.string()
		.trim()
		.refine((value) => !value || isValidDateInput(value), {
			message: "Informe uma data de pagamento válida.",
		})
		.optional()
		.nullable(),
	isSettled: z.boolean().nullable().optional(),
});

export type UpdateBulkInput = z.infer<typeof updateBulkSchema>;

const massAddTransactionSchema = z.object({
	purchaseDate: z
		.string({ message: "Informe a data da transação." })
		.trim()
		.refine((value) => isValidDateInput(value), {
			message: "Data da transação inválida.",
		}),
	name: z
		.string({ message: "Informe o estabelecimento." })
		.trim()
		.min(1, "Informe o estabelecimento."),
	amount: z.coerce
		.number({ message: "Informe o valor da transação." })
		.min(0, "Informe um valor maior ou igual a zero."),
	categoryId: uuidSchema("Category").nullable().optional(),
	payerId: uuidSchema("Payer").nullable().optional(),
});

export const massAddSchema = z.object({
	fixedFields: z.object({
		transactionType: z.enum(TRANSACTION_TYPES).optional(),
		paymentMethod: z.enum(PAYMENT_METHODS).optional(),
		condition: z.enum(TRANSACTION_CONDITIONS).optional(),
		period: z
			.string()
			.trim()
			.regex(/^(\d{4})-(\d{2})$/, {
				message: "Selecione um período válido.",
			})
			.optional(),
		accountId: uuidSchema("FinancialAccount").nullable().optional(),
		cardId: uuidSchema("Cartão").nullable().optional(),
	}),
	transactions: z
		.array(massAddTransactionSchema)
		.min(1, "Adicione pelo menos uma transação."),
});

export type MassAddInput = z.infer<typeof massAddSchema>;

export const deleteMultipleSchema = z.object({
	ids: z
		.array(uuidSchema("Lançamento"))
		.min(1, "Selecione pelo menos um lançamento."),
});

export type DeleteMultipleInput = z.infer<typeof deleteMultipleSchema>;
