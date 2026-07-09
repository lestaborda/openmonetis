"use client";

import { useState } from "react";
import {
	DEFAULT_RECURRENCE_COUNT,
	MAX_RECURRENCE_COUNT,
	TRANSACTION_CONDITIONS,
} from "@/features/transactions/lib/constants";
import { Label } from "@/shared/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { formatCurrency } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/ui";
import { ConditionSelectContent } from "../../select-items";
import type { ConditionSectionProps } from "./transaction-dialog-types";

function InlineStartInstallmentPicker({
	value,
	options,
	onChange,
}: {
	value: string;
	options: number[];
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const selected = Number(value || "1");
	const selectedLabel =
		!Number.isNaN(selected) && selected > 0
			? `${selected}ª parcela`
			: "1ª parcela";
	const disabled = options.length === 0;

	return (
		<div className="ml-1">
			<span className="text-xs text-muted-foreground">Começar em </span>
			<Popover modal open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="cursor-pointer text-xs text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:no-underline"
						disabled={disabled}
					>
						{selectedLabel}
					</button>
				</PopoverTrigger>
				<PopoverContent className="w-40 p-1" align="start">
					<div className="max-h-56 overflow-y-auto">
						{options.map((option) => (
							<button
								key={option}
								type="button"
								className={cn(
									"flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
									option === selected && "font-medium text-primary",
								)}
								onClick={() => {
									onChange(String(option));
									setOpen(false);
								}}
							>
								{option}ª parcela
							</button>
						))}
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}

export function ConditionSection({
	formState,
	onFieldChange,
	showInstallments,
	showRecurrence,
}: ConditionSectionProps) {
	const parsedAmount = Number(formState.amount);
	const amount =
		Number.isNaN(parsedAmount) || parsedAmount <= 0 ? null : parsedAmount;

	const getInstallmentLabel = (count: number) => {
		if (amount) {
			const installmentValue = amount / count;
			return `${count}x de R$ ${formatCurrency(installmentValue)}`;
		}

		return `${count}x`;
	};

	const installmentCount = Number(formState.installmentCount);
	const installmentSummary =
		showInstallments &&
		formState.installmentCount &&
		!Number.isNaN(installmentCount) &&
		installmentCount > 0
			? getInstallmentLabel(installmentCount)
			: null;
	const startInstallmentOptions =
		showInstallments &&
		formState.installmentCount &&
		!Number.isNaN(installmentCount) &&
		installmentCount > 0
			? Array.from({ length: installmentCount }, (_, index) => index + 1)
			: [];

	return (
		<div className="flex w-full flex-col gap-2 md:flex-row">
			<div
				className={cn(
					"space-y-1 w-full",
					showInstallments || showRecurrence ? "md:w-1/2" : "md:w-full",
				)}
			>
				<Label htmlFor="condition">Condição</Label>
				<Select
					value={formState.condition}
					onValueChange={(value) => onFieldChange("condition", value)}
				>
					<SelectTrigger id="condition" className="w-full">
						<SelectValue placeholder="Selecione">
							{formState.condition && (
								<ConditionSelectContent label={formState.condition} />
							)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{TRANSACTION_CONDITIONS.map((condition) => (
							<SelectItem key={condition} value={condition}>
								<ConditionSelectContent label={condition} />
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{showInstallments ? (
				<div className="space-y-1 w-full md:w-1/2">
					<Label htmlFor="installmentCount">Parcelado em</Label>
					<Select
						value={formState.installmentCount}
						onValueChange={(value) => onFieldChange("installmentCount", value)}
					>
						<SelectTrigger id="installmentCount" className="w-full">
							<SelectValue placeholder="Selecione">
								{installmentSummary}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{[...Array(24)].map((_, index) => {
								const count = index + 2;
								return (
									<SelectItem key={count} value={String(count)}>
										{getInstallmentLabel(count)}
									</SelectItem>
								);
							})}
						</SelectContent>
					</Select>
					<InlineStartInstallmentPicker
						value={formState.startInstallment}
						options={startInstallmentOptions}
						onChange={(value) => onFieldChange("startInstallment", value)}
					/>
				</div>
			) : null}

			{showRecurrence ? (
				<div className="space-y-1 w-full md:w-1/2">
					<Label htmlFor="recurrenceCount">Próximos meses</Label>
					<Select
						value={
							formState.recurrenceCount || String(DEFAULT_RECURRENCE_COUNT)
						}
						onValueChange={(value) => onFieldChange("recurrenceCount", value)}
					>
						<SelectTrigger id="recurrenceCount" className="w-full">
							<SelectValue>
								{`${formState.recurrenceCount || DEFAULT_RECURRENCE_COUNT} meses`}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{[...Array(MAX_RECURRENCE_COUNT - 1)].map((_, index) => (
								<SelectItem key={index + 2} value={String(index + 2)}>
									{index + 2} meses
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground">
						Cria lançamentos mensais com o mesmo valor. Se parar de pagar,
						exclua da série a partir do mês em que não pagará mais.
					</p>
				</div>
			) : null}
		</div>
	);
}
