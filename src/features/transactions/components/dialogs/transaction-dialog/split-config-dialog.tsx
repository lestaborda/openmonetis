"use client";

import { SPLIT_MODES } from "@/features/transactions/lib/constants";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { CurrencyInput } from "@/shared/components/ui/currency-input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { formatCurrency } from "@/shared/utils/currency";
import { safeToNumber } from "@/shared/utils/number";
import { cn } from "@/shared/utils/ui";
import { PayerSelectContent } from "../../select-items";
import type { FormState } from "./transaction-dialog-types";

const splitRowClassName =
	"grid min-h-[2rem] items-center gap-2 rounded-lg border p-1.5 transition-colors sm:grid-cols-[minmax(0,1fr)_7rem_5.5rem]";
const splitDisabledFieldClassName =
	"hidden h-9 rounded-md border border-transparent sm:block";

type SplitConfigDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: FormState;
	onFieldChange: <Key extends keyof FormState>(
		key: Key,
		value: FormState[Key],
	) => void;
	payerOptions: Array<{
		value: string;
		label: string;
		role?: string | null;
		avatarUrl?: string | null;
	}>;
	splitPayerOptions: Array<{
		value: string;
		label: string;
		avatarUrl?: string | null;
	}>;
	totalAmount: number;
};

const getPercentValue = (amount: string, totalAmount: number) => {
	if (totalAmount <= 0) return "0%";
	const percentage = (safeToNumber(amount) / totalAmount) * 100;
	return percentage.toLocaleString("pt-BR", {
		maximumFractionDigits: 1,
	});
};

const percentToAmount = (percent: string, totalAmount: number) => {
	const normalized = percent.replace(/[^\d.,]/g, "").replace(",", ".");
	const percentage = Number(normalized);

	if (!Number.isFinite(percentage) || totalAmount <= 0) return "0.00";

	const clamped = Math.min(100, Math.max(0, percentage));
	return ((totalAmount * clamped) / 100).toFixed(2);
};

const getEqualAmounts = (count: number, totalAmount: number) => {
	if (count <= 0 || totalAmount <= 0) return [];

	const centsTotal = Math.round(totalAmount * 100);
	const baseCents = Math.floor(centsTotal / count);
	let remainder = centsTotal - baseCents * count;

	return Array.from({ length: count }, () => {
		const cents = baseCents + (remainder > 0 ? 1 : 0);
		remainder -= 1;
		return (cents / 100).toFixed(2);
	});
};

type SplitSummaryPayerOption = {
	value: string;
	label: string;
	avatarUrl?: string | null;
};

export function getSplitSummaryData(
	formState: FormState,
	payerOptions: SplitSummaryPayerOption[],
	totalAmount: number,
) {
	if (!formState.isSplit) {
		return {
			type: "text" as const,
			label: "Atribuir partes do valor a outras pessoas.",
		};
	}

	const isReimbursement = formState.splitMode === SPLIT_MODES.REIMBURSEMENT;

	if (isReimbursement) {
		const receivableTotal = formState.splitShares.reduce(
			(sum, share) => sum + safeToNumber(share.amount),
			0,
		);
		const debtorNames = formState.splitShares
			.map((share) =>
				payerOptions.find((option) => option.value === share.payerId),
			)
			.filter(Boolean)
			.map((option) => option?.label.split(/\s+/)[0] ?? "")
			.filter(Boolean);

		return {
			type: "reimbursement" as const,
			expenseLabel: formatCurrency(totalAmount),
			receivableLabel: formatCurrency(receivableTotal),
			debtorLabel: debtorNames.join(", ") || "Configure o reembolso",
		};
	}

	const participants = [
		formState.payerId,
		...formState.splitShares.map((share) => share.payerId),
	].filter(Boolean);

	if (participants.length <= 1) {
		return {
			type: "text" as const,
			label: "Configure as pessoas e os valores da divisão.",
		};
	}

	const total =
		safeToNumber(formState.primarySplitAmount) +
		formState.splitShares.reduce(
			(sum, share) => sum + safeToNumber(share.amount),
			0,
		);
	const displayedParticipants = participants
		.slice(0, 3)
		.map((payerId) => payerOptions.find((option) => option.value === payerId))
		.filter(Boolean)
		.map((option) => ({
			label: option?.label ?? "",
			firstName: option?.label.split(/\s+/)[0] ?? "",
			avatarUrl: option?.avatarUrl ?? null,
		}));
	const remainingCount = Math.max(0, participants.length - 3);
	const totalLabel =
		Math.abs(total - totalAmount) <= 0.01
			? formatCurrency(totalAmount)
			: `${formatCurrency(total)} de ${formatCurrency(totalAmount)}`;

	return {
		type: "split" as const,
		count: participants.length,
		participants: displayedParticipants,
		remainingCount,
		totalLabel,
	};
}

export function SplitConfigDialog({
	open,
	onOpenChange,
	formState,
	onFieldChange,
	payerOptions,
	splitPayerOptions,
	totalAmount,
}: SplitConfigDialogProps) {
	const isReimbursement = formState.splitMode === SPLIT_MODES.REIMBURSEMENT;
	const selectedSplitIds = new Set(
		formState.splitShares.map((share) => share.payerId),
	);
	const availableSplitOptions = splitPayerOptions.filter(
		(option) => option.value !== formState.payerId,
	);
	const primaryPayerOption =
		payerOptions.find((option) => option.value === formState.payerId) ??
		payerOptions.find((option) => option.role === "admin") ??
		null;
	const splitTotal = isReimbursement
		? formState.splitShares.reduce(
				(total, share) => total + safeToNumber(share.amount),
				0,
			)
		: safeToNumber(formState.primarySplitAmount) +
			formState.splitShares.reduce(
				(total, share) => total + safeToNumber(share.amount),
				0,
			);
	const splitDifference = totalAmount - splitTotal;
	const hasSplitDifference = isReimbursement
		? splitDifference < -0.01
		: Math.abs(splitDifference) > 0.01;
	const splitDifferenceLabel = isReimbursement
		? `Excede o total em ${formatCurrency(Math.abs(splitDifference))}`
		: splitDifference > 0
			? `Faltam ${formatCurrency(splitDifference)}`
			: `Sobram ${formatCurrency(Math.abs(splitDifference))}`;

	const applyEqualSplit = (shares = formState.splitShares) => {
		if (isReimbursement) {
			const amounts = getEqualAmounts(shares.length, totalAmount);
			if (amounts.length === 0) return;
			onFieldChange(
				"splitShares",
				shares.map((share, index) => ({
					...share,
					amount: amounts[index] ?? "0.00",
				})),
			);
			return;
		}

		const participantCount = (formState.payerId ? 1 : 0) + shares.length;
		const amounts = getEqualAmounts(participantCount, totalAmount);

		if (amounts.length === 0) return;

		onFieldChange("primarySplitAmount", amounts[0] ?? "0.00");
		onFieldChange(
			"splitShares",
			shares.map((share, index) => ({
				...share,
				amount: amounts[index + 1] ?? "0.00",
			})),
		);
	};

	const toggleSplitPayer = (payerId: string, checked: boolean) => {
		const nextShares = checked
			? [...formState.splitShares, { payerId, amount: "0.00" }]
			: formState.splitShares.filter((share) => share.payerId !== payerId);

		applyEqualSplit(nextShares);
	};

	const handleSecondaryAmountChange = (payerId: string, value: string) => {
		const nextShares = formState.splitShares.map((share) =>
			share.payerId === payerId ? { ...share, amount: value } : share,
		);

		onFieldChange("splitShares", nextShares);

		if (isReimbursement) {
			return;
		}

		const othersTotal = nextShares.reduce(
			(total, share) => total + safeToNumber(share.amount),
			0,
		);

		onFieldChange(
			"primarySplitAmount",
			Math.max(0, totalAmount - othersTotal).toFixed(2),
		);
	};

	const handleSecondaryPercentChange = (payerId: string, percent: string) => {
		handleSecondaryAmountChange(payerId, percentToAmount(percent, totalAmount));
	};

	const handleDisableSplit = () => {
		onFieldChange("isSplit", false);
		onOpenChange(false);
	};

	const renderPercentInput = (
		amount: string,
		onPercentChange: (percent: string) => void,
		ariaLabel: string,
	) => (
		<div className="relative">
			<Input
				type="text"
				inputMode="decimal"
				value={getPercentValue(amount, totalAmount)}
				onChange={(event) => onPercentChange(event.target.value)}
				placeholder="0"
				aria-label={ariaLabel}
				className="h-9 pr-7 text-sm"
			/>
			<span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
				%
			</span>
		</div>
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[90vh] min-w-0 flex-col overflow-hidden sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Dividir lançamento</DialogTitle>
					<DialogDescription>
						{isReimbursement
							? "Registre a saída integral e o que cada pessoa deve reembolsar."
							: "Marque as pessoas e ajuste os valores se precisar."}
					</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 space-y-2 overflow-y-auto pr-1">
					<RadioGroup
						value={formState.splitMode || SPLIT_MODES.REIMBURSEMENT}
						onValueChange={(value) =>
							onFieldChange("splitMode", value as FormState["splitMode"])
						}
						className="grid gap-2 sm:grid-cols-2"
					>
						<div className="flex items-start gap-2 rounded-lg border p-3">
							<RadioGroupItem
								value={SPLIT_MODES.COST_SHARE}
								id="split-mode-cost-share"
								className="mt-0.5"
							/>
							<Label
								htmlFor="split-mode-cost-share"
								className="cursor-pointer space-y-1 font-normal"
							>
								<span className="block text-sm font-medium">
									Partilhar custo
								</span>
								<span className="block text-xs text-muted-foreground">
									Cada pessoa recebe sua parte como despesa.
								</span>
							</Label>
						</div>
						<div className="flex items-start gap-2 rounded-lg border p-3">
							<RadioGroupItem
								value={SPLIT_MODES.REIMBURSEMENT}
								id="split-mode-reimbursement"
								className="mt-0.5"
							/>
							<Label
								htmlFor="split-mode-reimbursement"
								className="cursor-pointer space-y-1 font-normal"
							>
								<span className="block text-sm font-medium">
									Pago antecipado
								</span>
								<span className="block text-xs text-muted-foreground">
									Saída integral + valores a receber de terceiros.
								</span>
							</Label>
						</div>
					</RadioGroup>

					{isReimbursement ? (
						<p className="rounded-lg border border-info/20 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
							<strong className="font-medium text-foreground">Pessoa</strong>{" "}
							indica quem pagou a despesa integral. A divisão abaixo define quem
							deve reembolsar.
						</p>
					) : null}

					<div
						className={cn(
							"flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5",
							hasSplitDifference
								? "border-destructive/30 bg-destructive/5"
								: "border-primary/20 bg-primary/5",
						)}
					>
						<div>
							<p className="text-sm font-medium">
								{formatCurrency(splitTotal)} de {formatCurrency(totalAmount)}
							</p>
							<p
								className={cn(
									"text-xs",
									hasSplitDifference
										? "text-destructive"
										: "text-muted-foreground",
								)}
							>
								{hasSplitDifference
									? splitDifferenceLabel
									: isReimbursement
										? "Valores a receber dentro do total"
										: "Tudo certo"}
							</p>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => applyEqualSplit()}
							disabled={
								totalAmount <= 0 ||
								!formState.payerId ||
								formState.splitShares.length === 0
							}
							className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
						>
							Dividir igualmente
						</Button>
					</div>

					<div className="space-y-2">
						{primaryPayerOption ? (
							<div
								className={cn(
									splitRowClassName,
									"bg-background",
									isReimbursement && "sm:grid-cols-[minmax(0,1fr)]",
								)}
							>
								<div className="flex min-w-0 items-center gap-2 text-sm">
									<Checkbox checked disabled aria-hidden />
									<PayerSelectContent
										label={primaryPayerOption.label}
										avatarUrl={primaryPayerOption.avatarUrl}
									/>
									{isReimbursement ? (
										<span className="ml-auto text-xs text-muted-foreground">
											Paga {formatCurrency(totalAmount)}
										</span>
									) : null}
								</div>
								{!isReimbursement ? (
									<>
										<CurrencyInput
											value={formState.primarySplitAmount}
											onValueChange={(value) =>
												onFieldChange("primarySplitAmount", value)
											}
											placeholder="R$ 0,00"
											aria-label={`Valor de ${primaryPayerOption.label}`}
											className="h-9 text-sm"
										/>
										{renderPercentInput(
											formState.primarySplitAmount,
											(percent) =>
												onFieldChange(
													"primarySplitAmount",
													percentToAmount(percent, totalAmount),
												),
											`Percentual de ${primaryPayerOption.label}`,
										)}
									</>
								) : null}
							</div>
						) : null}

						{availableSplitOptions.map((option) => {
							const isSelected = selectedSplitIds.has(option.value);
							const share = formState.splitShares.find(
								(item) => item.payerId === option.value,
							);

							return (
								<div
									key={option.value}
									className={cn(
										splitRowClassName,
										isSelected
											? "bg-background"
											: "border-border/60 bg-muted/20 opacity-60",
									)}
								>
									<label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
										<Checkbox
											checked={isSelected}
											onCheckedChange={(checked) =>
												toggleSplitPayer(option.value, Boolean(checked))
											}
										/>
										<span className="min-w-0 flex-1">
											<PayerSelectContent
												label={option.label}
												avatarUrl={option.avatarUrl}
											/>
										</span>
									</label>
									{isSelected && share ? (
										<>
											<CurrencyInput
												value={share.amount}
												onValueChange={(value) =>
													handleSecondaryAmountChange(option.value, value)
												}
												placeholder="R$ 0,00"
												aria-label={`Valor de ${option.label}`}
												className="h-9 text-sm"
											/>
											{renderPercentInput(
												share.amount,
												(percent) =>
													handleSecondaryPercentChange(option.value, percent),
												`Percentual de ${option.label}`,
											)}
										</>
									) : (
										<>
											<div className={splitDisabledFieldClassName} />
											<div className={splitDisabledFieldClassName} />
										</>
									)}
								</div>
							);
						})}
					</div>
				</div>

				<DialogFooter className="shrink-0">
					<Button type="button" variant="outline" onClick={handleDisableSplit}>
						Cancelar divisão
					</Button>
					<Button type="button" onClick={() => onOpenChange(false)}>
						Concluir
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
