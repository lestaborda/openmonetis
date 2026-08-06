"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { RiHandCoinLine, RiSliceFill } from "@remixicon/react";
import { useState } from "react";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/shared/components/ui/avatar";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { getAvatarSrc } from "@/shared/lib/payers/utils";
import { cn } from "@/shared/utils/ui";
import { PayerSelectContent } from "../../select-items";
import { getSplitSummaryData, SplitConfigDialog } from "./split-config-dialog";
import type { PayerSectionProps } from "./transaction-dialog-types";

type SplitSummary = ReturnType<typeof getSplitSummaryData>;

function SplitSummaryContent({ summary }: { summary: SplitSummary }) {
	if (summary.type === "text") {
		return <p className="text-xs text-muted-foreground">{summary.label}</p>;
	}

	if (summary.type === "reimbursement") {
		return (
			<p className="text-xs text-muted-foreground">
				Saída {summary.expenseLabel} · A receber {summary.receivableLabel} de{" "}
				{summary.debtorLabel}
			</p>
		);
	}

	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
			<span>{summary.count} pessoas:</span>
			{summary.participants.map((participant, index) => {
				const initial = participant.label.charAt(0).toUpperCase() || "?";

				return (
					<span
						key={`${participant.label}-${index}`}
						className="inline-flex min-w-0 items-center gap-0.5"
					>
						<Avatar className="size-4 border border-border/60 bg-background">
							<AvatarImage
								src={getAvatarSrc(participant.avatarUrl)}
								alt={`Avatar de ${participant.label}`}
							/>
							<AvatarFallback className="text-[0.55rem] font-medium uppercase">
								{initial}
							</AvatarFallback>
						</Avatar>
						<span>{participant.firstName}</span>
					</span>
				);
			})}
			{summary.remainingCount > 0 ? (
				<span>+{summary.remainingCount}</span>
			) : null}
			<span aria-hidden>·</span>
			<span>{summary.totalLabel}</span>
		</div>
	);
}

export function PayerSection({
	formState,
	onFieldChange,
	payerOptions,
	splitPayerOptions,
	totalAmount,
}: PayerSectionProps) {
	const [splitConfigOpen, setSplitConfigOpen] = useState(false);
	const splitSummary = getSplitSummaryData(
		formState,
		payerOptions,
		totalAmount,
	);
	const isIncome = formState.transactionType === "Receita";
	const showReceivable = isIncome && !formState.isSplit;
	const showSplit = !formState.isReceivable;
	const debtorOptions = splitPayerOptions.filter(
		(option) => option.value !== formState.payerId,
	);

	const handleSplitToggle = (checked: boolean) => {
		onFieldChange("isSplit", checked);

		if (checked) {
			setSplitConfigOpen(true);
		}
	};

	const handleSplitCardClick = () => {
		if (formState.isSplit) {
			setSplitConfigOpen(true);
			return;
		}

		handleSplitToggle(true);
	};

	const handleReceivableToggle = (checked: boolean) => {
		onFieldChange("isReceivable", checked);
	};

	const selectedDebtor = formState.reimbursementDebtorId
		? debtorOptions.find((opt) => opt.value === formState.reimbursementDebtorId)
		: undefined;

	return (
		<div className="space-y-3">
			<div className="space-y-1">
				<Label htmlFor="payer">Pessoa</Label>
				<Select
					value={formState.payerId ?? ""}
					onValueChange={(value) => onFieldChange("payerId", value)}
				>
					<SelectTrigger id="payer" className="w-full">
						<SelectValue placeholder="Selecione">
							{formState.payerId &&
								(() => {
									const selectedOption = payerOptions.find(
										(opt) => opt.value === formState.payerId,
									);
									return selectedOption ? (
										<PayerSelectContent
											label={selectedOption.label}
											avatarUrl={selectedOption.avatarUrl}
										/>
									) : null;
								})()}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{payerOptions.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								<PayerSelectContent
									label={option.label}
									avatarUrl={option.avatarUrl}
								/>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{showReceivable ? (
				<div
					className={cn(
						"rounded-lg border px-3 py-2.5 transition-colors",
						formState.isReceivable
							? "border-primary/20 bg-primary/5"
							: "border-border bg-transparent",
					)}
				>
					<div className="flex items-start justify-between gap-3">
						<button
							type="button"
							className="min-w-0 flex-1 space-y-0.5 text-left"
							onClick={() => handleReceivableToggle(!formState.isReceivable)}
						>
							<p className="text-sm text-foreground">A receber</p>
							<p className="text-xs text-muted-foreground">
								{formState.isReceivable && selectedDebtor
									? `Pendente de ${selectedDebtor.label.split(" ")[0] ?? selectedDebtor.label}`
									: "Marque se alguém ainda vai te pagar este valor"}
							</p>
						</button>
						<CheckboxPrimitive.Root
							checked={formState.isReceivable}
							onCheckedChange={(checked) =>
								handleReceivableToggle(Boolean(checked))
							}
							aria-label="Marcar como a receber"
							className={cn(
								"peer mt-0.5 size-4 shrink-0 rounded-lg border shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
								formState.isReceivable
									? "border-primary bg-primary text-primary-foreground"
									: "border-input dark:bg-input/30",
							)}
						>
							<CheckboxPrimitive.Indicator className="grid place-content-center text-current transition-none">
								<RiHandCoinLine className="size-3" />
							</CheckboxPrimitive.Indicator>
						</CheckboxPrimitive.Root>
					</div>

					{formState.isReceivable ? (
						<div className="mt-3 space-y-1">
							<Label htmlFor="receivable-debtor">Pessoa que deve</Label>
							<Select
								value={formState.reimbursementDebtorId ?? ""}
								onValueChange={(value) =>
									onFieldChange("reimbursementDebtorId", value)
								}
							>
								<SelectTrigger id="receivable-debtor" className="w-full">
									<SelectValue placeholder="Selecione">
										{selectedDebtor ? (
											<PayerSelectContent
												label={selectedDebtor.label}
												avatarUrl={selectedDebtor.avatarUrl}
											/>
										) : null}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{debtorOptions.length === 0 ? (
										<div className="px-2 py-6 text-center">
											<p className="text-sm text-muted-foreground">
												Nenhuma outra pessoa cadastrada
											</p>
										</div>
									) : (
										debtorOptions.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												<PayerSelectContent
													label={option.label}
													avatarUrl={option.avatarUrl}
												/>
											</SelectItem>
										))
									)}
								</SelectContent>
							</Select>
						</div>
					) : null}
				</div>
			) : null}

			{showSplit ? (
				<div
					className={cn(
						"rounded-lg border px-3 py-2.5 transition-colors",
						formState.isSplit
							? "border-primary/20 bg-primary/5"
							: "border-border bg-transparent",
					)}
				>
					<div className="flex items-start justify-between gap-3">
						<button
							type="button"
							className="min-w-0 flex-1 space-y-0.5 text-left"
							onClick={handleSplitCardClick}
						>
							<p className="text-sm text-foreground">Dividir lançamento</p>
							<SplitSummaryContent summary={splitSummary} />
						</button>
						<CheckboxPrimitive.Root
							checked={formState.isSplit}
							onCheckedChange={(checked) => handleSplitToggle(Boolean(checked))}
							aria-label="Dividir lançamento"
							className={cn(
								"peer mt-0.5 size-4 shrink-0 rounded-lg border shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
								formState.isSplit
									? "border-primary bg-primary text-primary-foreground"
									: "border-input dark:bg-input/30",
							)}
						>
							<CheckboxPrimitive.Indicator className="grid place-content-center text-current transition-none">
								<RiSliceFill className="size-3" />
							</CheckboxPrimitive.Indicator>
						</CheckboxPrimitive.Root>
					</div>

					{formState.isSplit ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3 w-full"
							onClick={() => setSplitConfigOpen(true)}
						>
							Editar divisão
						</Button>
					) : null}
				</div>
			) : null}

			<SplitConfigDialog
				open={splitConfigOpen}
				onOpenChange={setSplitConfigOpen}
				formState={formState}
				onFieldChange={onFieldChange}
				payerOptions={payerOptions}
				splitPayerOptions={splitPayerOptions}
				totalAmount={totalAmount}
			/>
		</div>
	);
}
