"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { transactions } from "@/db/schema";
import {
	fetchOwnedCategoryIds,
	fetchOwnedPayerIds,
	validateCartaoOwnership,
	validateContaOwnership,
} from "@/features/transactions/actions/core";
import { createOfxImportFingerprint } from "@/features/transactions/lib/ofx-import-fingerprint";
import { revalidateForEntity } from "@/shared/lib/actions/helpers";
import { getUserId } from "@/shared/lib/auth/server";
import { db } from "@/shared/lib/db";
import {
	normalizeOfxIdentityText,
	type OfxIdentityRow,
	type OfxImportDestination,
} from "@/shared/lib/import/ofx-identity";
import { uuidSchema } from "@/shared/lib/schemas/common";
import { formatDecimalForDbRequired } from "@/shared/utils/currency";
import { parseLocalDateString, toDateOnlyString } from "@/shared/utils/date";

const ofxIdentityRowSchema = z.object({
	externalId: z.string().nullable(),
	externalIdOccurrence: z.number().int().nonnegative(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
	amount: z.number().positive(),
	transactionType: z.enum(["income", "expense"]),
	sourceDescription: z.string(),
});

const ofxImportDestinationSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("account"), id: uuidSchema("Conta") }),
	z.object({ type: z.literal("card"), id: uuidSchema("Cartão") }),
]);

const duplicateCheckSchema = z.object({
	source: z.string().min(1),
	accountNumber: z.string().nullable(),
	destination: ofxImportDestinationSchema,
	rows: z.array(ofxIdentityRowSchema),
});

const importRowSchema = ofxIdentityRowSchema.extend({
	description: z.string().min(1, "Descrição obrigatória."),
	categoryId: uuidSchema("Category").nullable().optional(),
	payerId: uuidSchema("Payer").nullable().optional(),
});

const importSchema = z.object({
	source: z.string().min(1),
	accountNumber: z.string().nullable(),
	rows: z.array(importRowSchema).min(1, "Selecione ao menos uma transação."),
	payerId: uuidSchema("Payer").nullable().optional(),
	accountId: uuidSchema("FinancialAccount").nullable().optional(),
	cardId: uuidSchema("Cartão").nullable().optional(),
	paymentMethod: z.string().min(1),
	invoicePeriod: z
		.string()
		.regex(/^\d{4}-\d{2}$/, "Período inválido.")
		.nullable()
		.optional(),
});

type ImportInput = z.infer<typeof importSchema>;

type ImportResult =
	| { success: true; imported: number; skipped: number; importBatchId: string }
	| { success: false; error: string };

type ImportMatch = {
	fingerprint: string | null;
	existingTransactionId: string | null;
};

type LegacyImportCandidate = {
	id: string;
	name: string;
	amount: string;
	purchaseDate: Date;
	transactionType: string;
	ofxFitId: string | null;
	accountId: string | null;
	cardId: string | null;
};

function isDestinationMatch(
	candidate: LegacyImportCandidate,
	destination: OfxImportDestination,
): boolean {
	return destination.type === "card"
		? candidate.cardId === destination.id
		: candidate.accountId === destination.id;
}

function isLegacyImportMatch(
	candidate: LegacyImportCandidate,
	row: OfxIdentityRow,
	destination: OfxImportDestination,
): boolean {
	if (
		!row.externalId ||
		row.externalIdOccurrence !== 0 ||
		candidate.ofxFitId !== row.externalId ||
		!isDestinationMatch(candidate, destination)
	) {
		return false;
	}

	const expectedType = row.transactionType === "income" ? "Receita" : "Despesa";
	const signedAmount =
		row.transactionType === "expense" ? -row.amount : row.amount;

	return (
		toDateOnlyString(candidate.purchaseDate) === row.date &&
		formatDecimalForDbRequired(Number(candidate.amount)) ===
			formatDecimalForDbRequired(signedAmount) &&
		candidate.transactionType === expectedType &&
		normalizeOfxIdentityText(candidate.name) ===
			normalizeOfxIdentityText(row.sourceDescription)
	);
}

async function findExistingImports(
	userId: string,
	source: string,
	accountNumber: string | null,
	destination: OfxImportDestination,
	rows: OfxIdentityRow[],
): Promise<ImportMatch[]> {
	const fingerprints = rows.map((row) =>
		createOfxImportFingerprint({
			source,
			accountNumber,
			destination,
			row,
		}),
	);
	const fingerprintValues = [
		...new Set(
			fingerprints.filter(
				(fingerprint): fingerprint is string => fingerprint !== null,
			),
		),
	];
	const fitIds = [
		...new Set(
			rows
				.map((row) => row.externalId)
				.filter((fitId): fitId is string => fitId !== null),
		),
	];

	const [fingerprintMatches, legacyCandidates] = await Promise.all([
		fingerprintValues.length > 0
			? db
					.select({
						id: transactions.id,
						fingerprint: transactions.ofxImportFingerprint,
					})
					.from(transactions)
					.where(
						and(
							eq(transactions.userId, userId),
							inArray(transactions.ofxImportFingerprint, fingerprintValues),
						),
					)
			: Promise.resolve([]),
		fitIds.length > 0
			? db
					.select({
						id: transactions.id,
						name: transactions.name,
						amount: transactions.amount,
						purchaseDate: transactions.purchaseDate,
						transactionType: transactions.transactionType,
						ofxFitId: transactions.ofxFitId,
						accountId: transactions.accountId,
						cardId: transactions.cardId,
					})
					.from(transactions)
					.where(
						and(
							eq(transactions.userId, userId),
							isNull(transactions.ofxImportFingerprint),
							inArray(transactions.ofxFitId, fitIds),
						),
					)
			: Promise.resolve([]),
	]);

	const transactionIdByFingerprint = new Map(
		fingerprintMatches.flatMap((match) =>
			match.fingerprint ? [[match.fingerprint, match.id] as const] : [],
		),
	);
	const consumedLegacyIds = new Set<string>();

	return rows.map((row, index) => {
		const fingerprint = fingerprints[index] ?? null;
		const currentTransactionId = fingerprint
			? (transactionIdByFingerprint.get(fingerprint) ?? null)
			: null;

		if (currentTransactionId) {
			return { fingerprint, existingTransactionId: currentTransactionId };
		}

		const legacyMatch = legacyCandidates.find(
			(candidate) =>
				!consumedLegacyIds.has(candidate.id) &&
				isLegacyImportMatch(candidate, row, destination),
		);

		if (legacyMatch) {
			consumedLegacyIds.add(legacyMatch.id);
		}

		return {
			fingerprint,
			existingTransactionId: legacyMatch?.id ?? null,
		};
	});
}

async function validateDestinationOwnership(
	userId: string,
	destination: OfxImportDestination,
): Promise<boolean> {
	return destination.type === "card"
		? validateCartaoOwnership(userId, destination.id)
		: validateContaOwnership(userId, destination.id);
}

export async function checkDuplicateOfxTransactions(
	input: unknown,
): Promise<
	{ success: true; rows: ImportMatch[] } | { success: false; error: string }
> {
	const userId = await getUserId();
	const parsed = duplicateCheckSchema.safeParse(input);

	if (!parsed.success) {
		return { success: false, error: "Dados do arquivo inválidos." };
	}

	const { source, accountNumber, destination, rows } = parsed.data;
	if (!(await validateDestinationOwnership(userId, destination))) {
		return { success: false, error: "Conta ou cartão não encontrado." };
	}

	return {
		success: true,
		rows: await findExistingImports(
			userId,
			source,
			accountNumber,
			destination,
			rows,
		),
	};
}

export async function importTransactionsAction(
	input: ImportInput,
): Promise<ImportResult> {
	const userId = await getUserId();
	const parsed = importSchema.safeParse(input);

	if (!parsed.success) {
		return {
			success: false,
			error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
		};
	}

	const {
		source,
		accountNumber,
		rows,
		payerId,
		accountId,
		cardId,
		paymentMethod,
		invoicePeriod,
	} = parsed.data;
	const destination: OfxImportDestination | null = cardId
		? { type: "card", id: cardId }
		: accountId
			? { type: "account", id: accountId }
			: null;

	if (!destination || (accountId && cardId)) {
		return { success: false, error: "Selecione uma conta ou cartão." };
	}

	const payerIdsByRow = rows.map((row) => row.payerId ?? payerId ?? null);

	if (payerIdsByRow.some((id) => !id)) {
		return { success: false, error: "Pessoa obrigatória." };
	}

	// Valida ownership
	const [ownedPayerIds, ownedCategoryIds, accountOk, cardOk] =
		await Promise.all([
			fetchOwnedPayerIds(userId, payerIdsByRow),
			fetchOwnedCategoryIds(
				userId,
				rows.map((row) => row.categoryId),
			),
			validateContaOwnership(userId, accountId),
			validateCartaoOwnership(userId, cardId),
		]);

	if (payerIdsByRow.some((id) => id && !ownedPayerIds.has(id))) {
		return { success: false, error: "Pessoa não encontrada." };
	}

	if (
		rows.some((row) => row.categoryId && !ownedCategoryIds.has(row.categoryId))
	) {
		return { success: false, error: "Categoria não encontrada." };
	}

	if (!accountOk) return { success: false, error: "Conta não encontrada." };
	if (!cardOk) return { success: false, error: "Cartão não encontrado." };

	const importMatches = await findExistingImports(
		userId,
		source,
		accountNumber,
		destination,
		rows,
	);
	const rowsToImport = rows.flatMap((row, index) => {
		const match = importMatches[index];
		return match?.existingTransactionId
			? []
			: [
					{
						row,
						payerId: payerIdsByRow[index],
						fingerprint: match?.fingerprint ?? null,
					},
				];
	});

	if (rowsToImport.length === 0) {
		return {
			success: true,
			imported: 0,
			skipped: rows.length,
			importBatchId: "",
		};
	}

	const importBatchId = crypto.randomUUID();

	// Cartão de crédito: fatura pode ainda não ter sido paga
	const isSettled = paymentMethod !== "Cartão de crédito";

	const records = rowsToImport.map(({ row, payerId, fingerprint }) => {
		const purchaseDate = parseLocalDateString(row.date);
		const period =
			invoicePeriod ??
			`${purchaseDate.getFullYear()}-${String(purchaseDate.getMonth() + 1).padStart(2, "0")}`;

		return {
			name: row.description,
			transactionType: row.transactionType === "income" ? "Receita" : "Despesa",
			condition: "À vista" as const,
			paymentMethod,
			amount: (row.transactionType === "expense"
				? -row.amount
				: row.amount
			).toFixed(2),
			purchaseDate,
			period,
			isSettled,
			userId,
			payerId,
			accountId: accountId ?? null,
			cardId: cardId ?? null,
			categoryId: row.categoryId ?? null,
			ofxFitId: row.externalId,
			ofxImportFingerprint: fingerprint,
			importBatchId,
		};
	});

	// O índice de fingerprint protege contra importações concorrentes do mesmo OFX.
	const inserted = await db
		.insert(transactions)
		.values(records)
		.onConflictDoNothing({
			target: [transactions.userId, transactions.ofxImportFingerprint],
			where: sql`ofx_import_fingerprint IS NOT NULL`,
		})
		.returning({ id: transactions.id });

	await revalidateForEntity("transactions", userId);

	return {
		success: true,
		imported: inserted.length,
		skipped: rows.length - inserted.length,
		importBatchId,
	};
}

export async function deleteImportedTransaction(
	transactionId: string,
): Promise<{ success: boolean; error?: string }> {
	const parsedId = uuidSchema("Lançamento").safeParse(transactionId);
	if (!parsedId.success) {
		return { success: false, error: "Lançamento inválido." };
	}

	const userId = await getUserId();

	const deleted = await db
		.delete(transactions)
		.where(
			and(eq(transactions.userId, userId), eq(transactions.id, parsedId.data)),
		)
		.returning({ id: transactions.id });

	if (deleted.length === 0) {
		return { success: false, error: "Lançamento não encontrado." };
	}

	await revalidateForEntity("transactions", userId);

	return { success: true };
}

export async function undoImportAction(
	importBatchId: string,
): Promise<{ success: boolean; error?: string }> {
	if (!importBatchId) return { success: false, error: "Batch inválido." };

	const userId = await getUserId();

	await db
		.delete(transactions)
		.where(
			and(
				eq(transactions.userId, userId),
				eq(transactions.importBatchId, importBatchId),
			),
		);

	await revalidateForEntity("transactions", userId);

	return { success: true };
}
