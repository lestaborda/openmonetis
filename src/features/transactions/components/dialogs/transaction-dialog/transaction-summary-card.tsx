"use client";

import {
	type RemixiconComponentType,
	RiBankCard2Line,
	RiBankLine,
	RiCalendarScheduleLine,
	RiPriceTag3Line,
} from "@remixicon/react";
import type { ReactNode } from "react";
import { SPLIT_MODES } from "@/features/transactions/lib/constants";
import { formatCurrency } from "@/shared/utils/currency";
import { safeToNumber } from "@/shared/utils/number";
import { MONTH_NAMES, parsePeriod } from "@/shared/utils/period";
import { cn } from "@/shared/utils/ui";
import type { SelectOption } from "../../types";
import type { FormState } from "./transaction-dialog-types";

type TransactionSummaryCardProps = {
	formState: FormState;
	payerOptions: SelectOption[];
	splitPayerOptions: SelectOption[];
	accountOptions: SelectOption[];
	cardOptions: SelectOption[];
	categoryOptions: SelectOption[];
};

type ShareSummary = {
	payerId: string | undefined;
	label: string;
	context?: string;
	amountCents: number;
};

type SummaryChipProps = {
	icon: RemixiconComponentType;
	children: ReactNode;
};

const splitCents = (totalCents: number, parts: number) => {
	if (parts <= 0) return [];

	const base = Math.trunc(totalCents / parts);
	const remainder = totalCents % parts;

	return Array.from(
		{ length: parts },
		(_, index) => base + (index < remainder ? 1 : 0),
	);
};

const toCents = (value: string | number) =>
	Math.round(safeToNumber(value) * 100);

const firstName = (label: string) => label.trim().split(/\s+/)[0] || label;

function getOptionLabel(options: SelectOption[], value?: string) {
	if (!value) return null;
	return options.find((option) => option.value === value)?.label ?? null;
}

function SummaryChip({ icon: Icon, children }: SummaryChipProps) {
	return (
		<span className="inline-flex items-center gap-1 rounded-md bg-background/70 px-1.5 py-0.5 text-[0.7rem] leading-5 text-foreground/80 ring-1 ring-primary/10">
			<Icon className="size-3 shrink-0 text-primary/65" aria-hidden />
			<span className="min-w-0 truncate">{children}</span>
		</span>
	);
}

function getPayerLabel(
	payerOptions: SelectOption[],
	splitPayerOptions: SelectOption[],
	payerId?: string,
) {
	if (!payerId) return null;

	return (
		payerOptions.find((option) => option.value === payerId)?.label ??
		splitPayerOptions.find((option) => option.value === payerId)?.label ??
		null
	);
}

function getShareSummaries(
	formState: FormState,
	payerOptions: SelectOption[],
	splitPayerOptions: SelectOption[],
	totalCents: number,
): ShareSummary[] {
	const resolvePayerName = (payerId?: string) =>
		getPayerLabel(payerOptions, splitPayerOptions, payerId) ?? "Pessoa";

	if (!formState.isSplit) {
		return [
			{
				payerId: formState.payerId,
				label: resolvePayerName(formState.payerId),
				amountCents: totalCents,
			},
		];
	}

	if (formState.splitMode === SPLIT_MODES.REIMBURSEMENT) {
		return [
			{
				payerId: formState.payerId,
				label: resolvePayerName(formState.payerId),
				context: "saída integral",
				amountCents: totalCents,
			},
			...formState.splitShares.map((share) => ({
				payerId: share.payerId,
				label: resolvePayerName(share.payerId),
				context: "a receber",
				amountCents: toCents(share.amount),
			})),
		];
	}

	const shares = [
		{
			payerId: formState.payerId,
			amountCents: toCents(formState.primarySplitAmount),
		},
		...formState.splitShares.map((share) => ({
			payerId: share.payerId,
			amountCents: toCents(share.amount),
		})),
	].filter((share) => share.payerId || share.amountCents > 0);

	return shares.map((share, index) => ({
		payerId: share.payerId,
		label:
			resolvePayerName(share.payerId) ??
			(index === 0 ? "Pessoa principal" : "Pessoa"),
		amountCents: share.amountCents,
	}));
}

function formatInstallmentPart(totalCents: number, installmentCount: number) {
	const parts = splitCents(totalCents, installmentCount);
	const uniqueValues = Array.from(new Set(parts));

	if (parts.length === 0) return null;
	if (uniqueValues.length === 1) {
		return `${installmentCount}x de ${formatCurrency(parts[0] / 100)}`;
	}

	return `${installmentCount}x de ~${formatCurrency(Math.max(...parts) / 100)}`;
}

function formatInvoicePeriod(period: string) {
	try {
		const { year, month } = parsePeriod(period);
		return `${MONTH_NAMES[month - 1]} de ${year}`;
	} catch {
		return period;
	}
}

export function TransactionSummaryCard({
	formState,
	payerOptions,
	splitPayerOptions,
	accountOptions,
	cardOptions,
	categoryOptions,
}: TransactionSummaryCardProps) {
	const totalCents = Math.abs(toCents(formState.amount));
	const totalAmount = totalCents / 100;
	const installmentCount = Math.max(
		0,
		Math.trunc(safeToNumber(formState.installmentCount)),
	);
	const startInstallment = Math.max(
		1,
		Math.trunc(safeToNumber(formState.startInstallment, 1)),
	);
	const isInstallment =
		formState.condition === "Parcelado" && installmentCount > 1;
	const remainingInstallments = isInstallment
		? Math.max(0, installmentCount - startInstallment + 1)
		: 1;
	const shares = getShareSummaries(
		formState,
		payerOptions,
		splitPayerOptions,
		totalCents,
	);
	const targetLabel =
		formState.paymentMethod === "Cartão de crédito"
			? getOptionLabel(cardOptions, formState.cardId)
			: getOptionLabel(accountOptions, formState.accountId);
	const categoryLabel = getOptionLabel(categoryOptions, formState.categoryId);
	const shareTotalCents = shares.reduce(
		(sum, share) => sum + share.amountCents,
		0,
	);
	const hasSplitDifference =
		formState.isSplit &&
		formState.splitMode !== SPLIT_MODES.REIMBURSEMENT &&
		Math.abs(shareTotalCents - totalCents) > 1;
	const displayedShares = shares.slice(0, 3);
	const remainingShares = Math.max(0, shares.length - displayedShares.length);
	const operationCount =
		Math.max(1, remainingInstallments) * Math.max(1, shares.length);
	const statusLabel =
		formState.paymentMethod === "Cartão de crédito"
			? `na fatura de ${formatInvoicePeriod(formState.period)}`
			: formState.isSettled
				? "como pago"
				: "em aberto";

	return (
		<section className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs shadow-xs shadow-primary/5">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-semibold text-foreground">Resumo da operação</p>
					<p className="mt-0.5 text-muted-foreground">
						{formState.transactionType || "Lançamento"} de{" "}
						<span className="font-medium text-foreground">
							{formatCurrency(totalAmount)}
						</span>{" "}
						{statusLabel}
					</p>
				</div>
				<span
					className={cn(
						"shrink-0 rounded-full px-2 py-0.5 font-medium",
						formState.transactionType === "Receita"
							? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
							: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
					)}
				>
					{operationCount} lançamento{operationCount > 1 ? "s" : ""}
				</span>
			</div>

			<div className="mt-2 flex flex-wrap gap-1 text-muted-foreground">
				<SummaryChip
					icon={
						formState.paymentMethod === "Cartão de crédito"
							? RiBankCard2Line
							: RiBankLine
					}
				>
					{formState.paymentMethod || "Forma não informada"}
				</SummaryChip>
				{targetLabel ? (
					<SummaryChip
						icon={
							formState.paymentMethod === "Cartão de crédito"
								? RiBankCard2Line
								: RiBankLine
						}
					>
						{targetLabel}
					</SummaryChip>
				) : null}
				{categoryLabel ? (
					<SummaryChip icon={RiPriceTag3Line}>{categoryLabel}</SummaryChip>
				) : null}
				{isInstallment ? (
					<SummaryChip icon={RiCalendarScheduleLine}>
						{startInstallment > 1
							? `${remainingInstallments} parcelas restantes de ${installmentCount}`
							: `${installmentCount} parcelas`}
					</SummaryChip>
				) : null}
			</div>

			<div className="mt-2 space-y-1">
				{displayedShares.map((share) => {
					const installmentLabel = isInstallment
						? formatInstallmentPart(share.amountCents, installmentCount)
						: null;

					return (
						<div
							key={`${share.payerId ?? share.label}-${share.amountCents}`}
							className="flex items-center justify-between gap-3 text-muted-foreground"
						>
							<span className="min-w-0 truncate">
								{firstName(share.label)}
								{share.context ? (
									<span className="text-muted-foreground/80">
										{" "}
										· {share.context}
									</span>
								) : null}
							</span>
							<span className="shrink-0 text-right text-foreground">
								{formatCurrency(share.amountCents / 100)}
								{installmentLabel ? (
									<span className="text-muted-foreground">
										{" "}
										· {installmentLabel}
									</span>
								) : null}
							</span>
						</div>
					);
				})}
				{remainingShares > 0 ? (
					<p className="text-muted-foreground">
						+{remainingShares} pessoas na divisão
					</p>
				) : null}
			</div>

			{hasSplitDifference ? (
				<p className="mt-2 text-[0.7rem] text-destructive">
					A divisão soma {formatCurrency(shareTotalCents / 100)} de{" "}
					{formatCurrency(totalAmount)}.
				</p>
			) : null}
		</section>
	);
}
