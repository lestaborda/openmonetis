"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	CategoryIconBadge,
	EstablishmentLogo,
} from "@/shared/components/entity-avatar";
import MoneyValues from "@/shared/components/money-values";
import { CurrencyInput } from "@/shared/components/ui/currency-input";
import { Input } from "@/shared/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { Spinner } from "@/shared/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils/ui";
import type { SelectOption, TransactionItem } from "../types";

export type InlineUpdatePayload = {
	id: string;
	name?: string;
	amount?: number;
	categoryId?: string | null;
};

export type InlineSaveHandler = (
	payload: InlineUpdatePayload,
) => Promise<boolean>;

function canInlineEditBase(item: TransactionItem) {
	return (
		!item.readonly &&
		item.transactionType !== "Transferência" &&
		item.categoriaName !== "Saldo inicial"
	);
}

function canInlineEditAmount(item: TransactionItem) {
	return (
		canInlineEditBase(item) && !(item.isDivided && !item.reimbursementDebtorId)
	);
}

type InlineNameCellProps = {
	item: TransactionItem;
	subtitle?: React.ReactNode;
	badges?: React.ReactNode;
	onSave: InlineSaveHandler;
};

export function InlineNameCell({
	item,
	subtitle,
	badges,
	onSave,
}: InlineNameCellProps) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(item.name);
	const [pending, startTransition] = useTransition();
	const inputRef = useRef<HTMLInputElement>(null);
	const editable = canInlineEditBase(item);

	useEffect(() => {
		setValue(item.name);
	}, [item.name]);

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [editing]);

	const commit = () => {
		const next = value.trim();
		if (!next || next === item.name) {
			setValue(item.name);
			setEditing(false);
			return;
		}

		startTransition(async () => {
			const ok = await onSave({ id: item.id, name: next });
			if (!ok) {
				setValue(item.name);
			}
			setEditing(false);
		});
	};

	if (editing) {
		return (
			<span className="flex items-center gap-2">
				<EstablishmentLogo name={value || item.name} size={32} />
				<span className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
					<span className="flex items-center gap-2">
						<Input
							ref={inputRef}
							value={value}
							disabled={pending}
							className="h-8 min-w-[140px] max-w-[220px]"
							aria-label="Editar estabelecimento"
							onChange={(event) => setValue(event.target.value)}
							onBlur={commit}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									commit();
								}
								if (event.key === "Escape") {
									event.preventDefault();
									setValue(item.name);
									setEditing(false);
								}
							}}
						/>
						{pending ? <Spinner className="size-3.5" /> : null}
					</span>
				</span>
			</span>
		);
	}

	return (
		<span className="flex items-center gap-2">
			<EstablishmentLogo name={item.name} size={32} />
			<span className="flex flex-col py-0.5">
				{subtitle}
				<span className="flex items-center gap-1">
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								disabled={!editable}
								className={cn(
									"line-clamp-2 max-w-[180px] truncate text-left font-semibold",
									editable &&
										"rounded-sm hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								)}
								onDoubleClick={(event) => {
									if (!editable) return;
									event.preventDefault();
									event.stopPropagation();
									setEditing(true);
								}}
								title={editable ? "Duplo clique para editar" : item.name}
							>
								{item.name}
							</button>
						</TooltipTrigger>
						<TooltipContent side="top" className="max-w-xs">
							{editable ? (
								<span>
									{item.name}
									<span className="mt-1 block text-xs text-muted-foreground">
										Duplo clique para editar
									</span>
								</span>
							) : (
								item.name
							)}
						</TooltipContent>
					</Tooltip>
					{badges}
				</span>
			</span>
		</span>
	);
}

type InlineAmountCellProps = {
	item: TransactionItem;
	onSave: InlineSaveHandler;
};

export function InlineAmountCell({ item, onSave }: InlineAmountCellProps) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(Math.abs(item.amount).toFixed(2));
	const [pending, startTransition] = useTransition();
	const editable = canInlineEditAmount(item);
	const isReceita = item.transactionType === "Receita";
	const isTransfer = item.transactionType === "Transferência";
	const isIncomingTransfer = isTransfer && Number(item.amount) > 0;

	useEffect(() => {
		setValue(Math.abs(item.amount).toFixed(2));
	}, [item.amount]);

	const commit = () => {
		const parsed = Number(value);
		if (Number.isNaN(parsed) || parsed < 0) {
			toast.error("Informe um valor válido.");
			setValue(Math.abs(item.amount).toFixed(2));
			setEditing(false);
			return;
		}

		if (Math.abs(parsed - Math.abs(item.amount)) < 0.001) {
			setEditing(false);
			return;
		}

		startTransition(async () => {
			const ok = await onSave({ id: item.id, amount: parsed });
			setEditing(false);
			if (!ok) {
				setValue(Math.abs(item.amount).toFixed(2));
			}
		});
	};

	if (editing) {
		return (
			<span className="inline-flex items-center gap-1.5">
				<CurrencyInput
					value={value}
					disabled={pending}
					className="h-8 w-[120px]"
					aria-label="Editar valor"
					autoFocus
					onValueChange={setValue}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commit();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							setValue(Math.abs(item.amount).toFixed(2));
							setEditing(false);
						}
					}}
				/>
				{pending ? <Spinner className="size-3.5" /> : null}
			</span>
		);
	}

	return (
		<button
			type="button"
			disabled={!editable}
			className={cn(
				"rounded-sm text-left",
				editable &&
					"hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			)}
			onDoubleClick={(event) => {
				if (!editable) return;
				event.preventDefault();
				event.stopPropagation();
				setEditing(true);
			}}
			title={editable ? "Duplo clique para editar" : undefined}
		>
			<MoneyValues
				amount={item.amount}
				showPositiveSign={isReceita || isIncomingTransfer}
				className={cn(
					"whitespace-nowrap",
					isReceita ? "text-success" : "text-foreground",
					isTransfer && "text-info",
				)}
			/>
		</button>
	);
}

type InlineCategoryCellProps = {
	item: TransactionItem;
	categoryOptions: SelectOption[];
	onSave: InlineSaveHandler;
};

export function InlineCategoryCell({
	item,
	categoryOptions,
	onSave,
}: InlineCategoryCellProps) {
	const [pending, startTransition] = useTransition();
	const editable = canInlineEditBase(item);
	const filteredOptions = categoryOptions.filter(
		(option) =>
			option.group?.toLowerCase() === item.transactionType.toLowerCase(),
	);

	if (!editable) {
		if (!item.categoriaName) {
			return <span className="text-muted-foreground">—</span>;
		}
		return (
			<span className="flex items-center gap-2">
				<CategoryIconBadge
					icon={item.categoriaIcon}
					name={item.categoriaName}
					size="sm"
				/>
				<span>{item.categoriaName}</span>
			</span>
		);
	}

	return (
		<span className="inline-flex min-w-[140px] max-w-[200px] items-center gap-1.5">
			<Select
				value={item.categoryId ?? ""}
				disabled={pending}
				onValueChange={(nextId) => {
					if (!nextId || nextId === item.categoryId) return;
					startTransition(async () => {
						await onSave({ id: item.id, categoryId: nextId });
					});
				}}
			>
				<SelectTrigger
					size="sm"
					className="h-8 border-transparent bg-transparent px-1 shadow-none hover:bg-accent/60 data-[state=open]:bg-accent/60"
					aria-label="Editar categoria"
					title="Clique para alterar a categoria"
				>
					<SelectValue placeholder="Categoria">
						{item.categoriaName ? (
							<span className="flex items-center gap-2 truncate">
								<CategoryIconBadge
									icon={item.categoriaIcon}
									name={item.categoriaName}
									size="sm"
								/>
								<span className="truncate">{item.categoriaName}</span>
							</span>
						) : (
							"—"
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{filteredOptions.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							<span className="flex items-center gap-2">
								<CategoryIconBadge
									icon={option.icon}
									name={option.label}
									size="sm"
								/>
								<span>{option.label}</span>
							</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{pending ? <Spinner className="size-3.5 shrink-0" /> : null}
		</span>
	);
}
