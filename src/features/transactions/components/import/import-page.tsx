"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	fetchCategoryMappings,
	saveCategoryMappings,
} from "@/features/transactions/actions/category-memory-action";
import {
	checkDuplicateOfxTransactions,
	deleteImportedTransaction,
	importTransactionsAction,
	undoImportAction,
} from "@/features/transactions/actions/import-action";
import {
	decodeAccountCard,
	encodeAccountCard,
	GlobalFields,
} from "@/features/transactions/components/import/global-fields";
import { ImportSteps } from "@/features/transactions/components/import/import-steps";
import { ImportSummary } from "@/features/transactions/components/import/import-summary";
import {
	type ReviewRow,
	ReviewTable,
} from "@/features/transactions/components/import/review-table";
import { UploadZone } from "@/features/transactions/components/import/upload-zone";
import type { SelectOption } from "@/features/transactions/components/types";
import { normalizeDescriptionKey } from "@/features/transactions/lib/import-utils";
import { Button } from "@/shared/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/shared/components/ui/card";
import { Skeleton } from "@/shared/components/ui/skeleton";
import type { ImportStatement } from "@/shared/lib/import/types";
import { createClientSafeId } from "@/shared/utils/id";

const categoryGroupByTransactionType = {
	expense: "despesa",
	income: "receita",
} as const;

const normalizeCategoryName = (value: string) => value.trim().toLowerCase();

interface ImportPageProps {
	payerOptions: SelectOption[];
	accountOptions: SelectOption[];
	cardOptions: SelectOption[];
	categoryOptions: SelectOption[];
	defaultPayerId: string | null;
}

export function ImportPage({
	payerOptions,
	accountOptions,
	cardOptions,
	categoryOptions,
	defaultPayerId,
}: ImportPageProps) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [isChecking, setIsChecking] = useState(false);
	const duplicateCheckRequestId = useRef(0);

	const [statement, setStatement] = useState<ImportStatement | null>(null);
	const [rows, setRows] = useState<ReviewRow[]>([]);
	const [payerId, setPayerId] = useState<string | null>(defaultPayerId);
	const [accountCardValue, setAccountCardValue] = useState<string | null>(null);
	const [invoicePeriod, setInvoicePeriod] = useState<string | null>(null);

	const categoryGroupById = useMemo(
		() =>
			new Map(categoryOptions.map((option) => [option.value, option.group])),
		[categoryOptions],
	);

	const isCategoryCompatible = useCallback(
		(
			categoryId: string | null,
			transactionType: ReviewRow["transactionType"],
		) =>
			!categoryId ||
			categoryGroupById.get(categoryId) ===
				categoryGroupByTransactionType[transactionType],
		[categoryGroupById],
	);

	const handleParsed = useCallback(
		async (stmt: ImportStatement) => {
			const requestId = ++duplicateCheckRequestId.current;
			setStatement(stmt);
			setIsChecking(true);
			const defaultAccountCardValue = stmt.isCreditCard
				? cardOptions[0]
					? encodeAccountCard("card", cardOptions[0].value)
					: null
				: accountOptions[0]
					? encodeAccountCard("account", accountOptions[0].value)
					: null;
			const destination = defaultAccountCardValue
				? decodeAccountCard(defaultAccountCardValue)
				: null;
			setAccountCardValue(defaultAccountCardValue);

			try {
				const [duplicateResult, categoryMappings] = await Promise.all([
					destination
						? checkDuplicateOfxTransactions({
								source: stmt.source,
								accountNumber: stmt.accountNumber,
								destination,
								rows: stmt.transactions,
							})
						: Promise.resolve({ success: true as const, rows: [] }),
					fetchCategoryMappings(stmt.transactions.map((t) => t.description)),
				]);
				if (requestId !== duplicateCheckRequestId.current) return;
				if (!duplicateResult.success) {
					toast.error(duplicateResult.error);
				}

				setRows(
					stmt.transactions.map((t, index) => {
						let mappedCategoryId =
							categoryMappings[normalizeDescriptionKey(t.description)] ?? null;
						const existingTransactionId = duplicateResult.success
							? (duplicateResult.rows[index]?.existingTransactionId ?? null)
							: null;

						if (t.categoryRaw) {
							const categoryRaw = normalizeCategoryName(t.categoryRaw);
							const matchedOption = categoryOptions.find(
								(opt) => normalizeCategoryName(opt.label) === categoryRaw,
							);
							if (matchedOption) {
								mappedCategoryId = matchedOption.value;
							}
						}

						return {
							...t,
							reviewId: createClientSafeId(),
							existingTransactionId,
							isDuplicate: existingTransactionId !== null,
							selected: existingTransactionId === null,
							payerId,
							categoryId: isCategoryCompatible(
								mappedCategoryId,
								t.transactionType,
							)
								? mappedCategoryId
								: null,
						};
					}),
				);
			} finally {
				if (requestId === duplicateCheckRequestId.current) {
					setIsChecking(false);
				}
			}
		},
		[
			accountOptions,
			cardOptions,
			categoryOptions,
			isCategoryCompatible,
			payerId,
		],
	);

	const handleAccountCardChange = async (value: string | null) => {
		const requestId = ++duplicateCheckRequestId.current;
		setAccountCardValue(value);
		const destination = value ? decodeAccountCard(value) : null;
		if (!statement || !destination) {
			setIsChecking(false);
			return;
		}

		setIsChecking(true);
		try {
			const result = await checkDuplicateOfxTransactions({
				source: statement.source,
				accountNumber: statement.accountNumber,
				destination,
				rows,
			});
			if (requestId !== duplicateCheckRequestId.current) return;
			if (!result.success) {
				toast.error(result.error);
				return;
			}

			setRows((previousRows) =>
				previousRows.map((row, index) => {
					const existingTransactionId =
						result.rows[index]?.existingTransactionId ?? null;
					const isDuplicate = existingTransactionId !== null;

					return {
						...row,
						existingTransactionId,
						selected:
							row.isDuplicate === isDuplicate ? row.selected : !isDuplicate,
						isDuplicate,
					};
				}),
			);
		} finally {
			if (requestId === duplicateCheckRequestId.current) {
				setIsChecking(false);
			}
		}
	};

	const toggleRow = (index: number) => {
		setRows((prev) =>
			prev.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r)),
		);
	};

	const toggleAll = (selected: boolean) => {
		setRows((prev) => prev.map((r) => ({ ...r, selected })));
	};

	const handleCategoryChange = (index: number, categoryId: string | null) => {
		setRows((prev) =>
			prev.map((r, i) =>
				i === index && isCategoryCompatible(categoryId, r.transactionType)
					? { ...r, categoryId }
					: r,
			),
		);
	};

	const handlePayerChange = (index: number, payerId: string | null) => {
		setRows((prev) =>
			prev.map((r, i) => (i === index ? { ...r, payerId } : r)),
		);
	};

	const handleUndoDuplicate = async (index: number) => {
		const row = rows[index];
		if (!row?.existingTransactionId) return;

		const result = await deleteImportedTransaction(row.existingTransactionId);
		if (!result.success) {
			toast.error("Não foi possível desfazer a importação anterior.");
			return;
		}

		setRows((prev) =>
			prev.map((r, i) =>
				i === index
					? {
							...r,
							existingTransactionId: null,
							isDuplicate: false,
							selected: true,
						}
					: r,
			),
		);
		toast.success("Importação anterior removida.");
	};

	const handleDescriptionChange = (index: number, description: string) => {
		setRows((prev) =>
			prev.map((r, i) => (i === index ? { ...r, description } : r)),
		);
	};

	const handleBulkCategoryChange = (categoryId: string) => {
		setRows((prev) =>
			prev.map((r) =>
				r.selected && isCategoryCompatible(categoryId, r.transactionType)
					? { ...r, categoryId }
					: r,
			),
		);
	};

	const handleBulkPayerChange = (nextPayerId: string | null) => {
		setPayerId(nextPayerId);
		setRows((prev) =>
			prev.map((r) => (r.selected ? { ...r, payerId: nextPayerId } : r)),
		);
	};

	const isCard = accountCardValue?.startsWith("card:") ?? false;

	const {
		selectedRows,
		duplicateCount,
		uncategorizedCount,
		withoutPayerCount,
	} = useMemo(() => {
		const selected = rows.filter((r) => r.selected);
		return {
			selectedRows: selected,
			duplicateCount: rows.filter((r) => r.isDuplicate).length,
			uncategorizedCount: selected.filter((r) => !r.categoryId).length,
			withoutPayerCount: selected.filter((r) => !r.payerId).length,
		};
	}, [rows]);

	const canImport =
		selectedRows.length > 0 &&
		!!accountCardValue &&
		uncategorizedCount === 0 &&
		withoutPayerCount === 0 &&
		(!isCard || !!invoicePeriod) &&
		!isPending;

	const handleImport = () => {
		if (!statement || !canImport) return;

		const decoded = accountCardValue
			? decodeAccountCard(accountCardValue)
			: null;
		const cardId = decoded?.type === "card" ? decoded.id : null;
		const accountId = decoded?.type === "account" ? decoded.id : null;
		const paymentMethod =
			decoded?.type === "card" ? "Cartão de crédito" : "Pix";

		startTransition(async () => {
			const result = await importTransactionsAction({
				source: statement.source,
				accountNumber: statement.accountNumber,
				rows: selectedRows.map((r) => ({
					externalId: r.externalId,
					externalIdOccurrence: r.externalIdOccurrence,
					date: r.date,
					amount: r.amount,
					description: r.description,
					sourceDescription: r.sourceDescription,
					transactionType: r.transactionType,
					categoryId: r.categoryId,
					payerId: r.payerId,
				})),
				payerId,
				accountId,
				cardId,
				paymentMethod,
				invoicePeriod,
			});

			if (!result.success) {
				toast.error(result.error);
				return;
			}

			// Salva mapeamentos description → category (fire-and-forget)
			saveCategoryMappings(
				selectedRows.map((r) => ({
					description: r.description,
					categoryId: r.categoryId,
				})),
			);

			const { importBatchId } = result;
			const msg =
				result.skipped > 0
					? `${result.imported} importados, ${result.skipped} duplicatas ignoradas.`
					: `${result.imported} lançamentos importados.`;

			router.push("/transactions");

			toast.success(msg, {
				duration: 8000,
				action: importBatchId
					? {
							label: "Desfazer",
							onClick: async () => {
								const undo = await undoImportAction(importBatchId);
								if (undo.success) {
									toast.success("Importação desfeita.");
								} else {
									toast.error("Não foi possível desfazer.");
								}
							},
						}
					: undefined,
			});
		});
	};

	const currentStep = !statement ? "upload" : isPending ? "done" : "review";

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-4">
					<div>
						<CardTitle>Importar extrato</CardTitle>
						<CardDescription>
							Importe transações a partir de um arquivo .ofx ou planilha .xlsx
							exportado pelo seu banco.
						</CardDescription>
					</div>
					<ImportSteps current={currentStep} />
				</div>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-6">
					{!statement || isChecking ? (
						<>
							{!statement && <UploadZone onParsed={handleParsed} />}
							{isChecking && (
								<div className="flex flex-col gap-3">
									<Skeleton className="h-10 w-full" />
									<Skeleton className="h-10 w-full" />
									<div className="flex flex-col gap-2 rounded-lg border p-4">
										{Array.from({ length: 6 }).map((_, i) => (
											<Skeleton key={i} className="h-8 w-full" />
										))}
									</div>
								</div>
							)}
						</>
					) : (
						<>
							<ImportSummary
								statement={statement}
								total={rows.length}
								selected={selectedRows.length}
								duplicates={duplicateCount}
								uncategorized={uncategorizedCount}
								withoutPayer={withoutPayerCount}
							/>

							<GlobalFields
								accountOptions={accountOptions}
								cardOptions={cardOptions}
								payerOptions={payerOptions}
								categoryOptions={categoryOptions}
								accountCardValue={accountCardValue}
								payerId={payerId}
								invoicePeriod={invoicePeriod}
								onAccountCardChange={handleAccountCardChange}
								onPayerChange={handleBulkPayerChange}
								onInvoicePeriodChange={setInvoicePeriod}
								onBulkCategoryChange={handleBulkCategoryChange}
							/>

							<ReviewTable
								rows={rows}
								payerOptions={payerOptions}
								categoryOptions={categoryOptions}
								onToggle={toggleRow}
								onToggleAll={toggleAll}
								onPayerChange={handlePayerChange}
								onCategoryChange={handleCategoryChange}
								onDescriptionChange={handleDescriptionChange}
								onUndoDuplicate={handleUndoDuplicate}
							/>

							{/* Sticky footer */}
							<div className="sticky bottom-0 -mx-6 px-6">
								<div className="flex items-center justify-between gap-4">
									<Button
										variant="outline"
										onClick={() => {
											setStatement(null);
											setRows([]);
											setAccountCardValue(null);
											setInvoicePeriod(null);
										}}
									>
										Trocar arquivo
									</Button>

									<div className="flex items-center gap-3">
										{!accountCardValue ? (
											<p className="text-muted-foreground text-sm">
												Selecione uma conta ou cartão para continuar.
											</p>
										) : uncategorizedCount > 0 ? (
											<p className="text-muted-foreground text-sm">
												{uncategorizedCount} lançamento
												{uncategorizedCount !== 1 ? "s" : ""} sem categoria.
											</p>
										) : isCard && !invoicePeriod ? (
											<p className="text-muted-foreground text-sm">
												Selecione a fatura para continuar.
											</p>
										) : null}
										<Button onClick={handleImport} disabled={!canImport}>
											{isPending
												? "Importando…"
												: `Importar ${selectedRows.length} lançamento${selectedRows.length !== 1 ? "s" : ""}`}
										</Button>
									</div>
								</div>
							</div>
						</>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
