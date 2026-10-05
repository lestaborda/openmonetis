"use client";

import {
	RiArrowRightLine,
	RiBarChartBoxLine,
	RiEyeLine,
	RiEyeOffLine,
} from "@remixicon/react";
import Image from "next/image";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { dashboardWidgetListStyles as styles } from "@/features/dashboard/components/dashboard-widget-list-styles";
import type { DashboardAccount } from "@/features/dashboard/lib/accounts-queries";
import { updateMyAccountsWidgetPreference } from "@/features/dashboard/widget-registry/widget-actions";
import MoneyValues from "@/shared/components/money-values";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CardFooter } from "@/shared/components/ui/card";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { WidgetEmptyState } from "@/shared/components/widgets/widget-empty-state";
import { isAccountInactive } from "@/shared/lib/accounts/constants";
import { resolveLogoSrc } from "@/shared/lib/logo";
import { buildInitials } from "@/shared/utils/initials";
import { formatPeriodForUrl } from "@/shared/utils/period";
import { cn } from "@/shared/utils/ui";

type MyAccountsWidgetProps = {
	accounts: DashboardAccount[];
	showExcludedAccounts: boolean;
	onShowExcludedAccountsChange?: (value: boolean) => void;
	totalBalance: number;
	period: string;
};

export function MyAccountsWidget({
	accounts,
	showExcludedAccounts,
	onShowExcludedAccountsChange,
	totalBalance,
	period,
}: MyAccountsWidgetProps) {
	const [isPending, startTransition] = useTransition();

	const activeAccounts = accounts.filter(
		(account) => !isAccountInactive(account.status),
	);
	const excludedAccountsCount = activeAccounts.filter(
		(account) => account.excludeFromBalance,
	).length;
	const totalIncludingExcluded = activeAccounts.reduce(
		(total, account) => total + account.balance,
		0,
	);
	const visibleAccounts = showExcludedAccounts
		? activeAccounts
		: activeAccounts.filter((account) => !account.excludeFromBalance);
	const displayedAccounts = visibleAccounts.slice(0, 5);
	const remainingCount = visibleAccounts.length - displayedAccounts.length;
	const toggleButtonLabel = showExcludedAccounts
		? "Ocultar contas não consideradas"
		: "Mostrar contas não consideradas";

	const handleToggleExcludedAccounts = () => {
		const nextShowExcludedAccounts = !showExcludedAccounts;
		onShowExcludedAccountsChange?.(nextShowExcludedAccounts);

		startTransition(async () => {
			const result = await updateMyAccountsWidgetPreference({
				showExcludedAccounts: nextShowExcludedAccounts,
			});

			if (!result.success) {
				onShowExcludedAccountsChange?.(!nextShowExcludedAccounts);
				toast.error(result.error ?? "Erro ao salvar preferência");
			}
		});
	};

	return (
		<>
			<div className="flex items-start justify-between gap-3 py-1">
				<div className="space-y-1">
					<p className="text-sm text-muted-foreground">Saldo total</p>
					<MoneyValues className="text-2xl font-medium" amount={totalBalance} />
					{excludedAccountsCount > 0 ? (
						<p className="pt-1 text-xs text-muted-foreground">
							Com não consideradas{" "}
							<MoneyValues
								className="font-medium text-foreground"
								amount={totalIncludingExcluded}
							/>
						</p>
					) : null}
				</div>

				{excludedAccountsCount > 0 ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								disabled={isPending}
								className="mt-0.5 text-muted-foreground"
								aria-label={toggleButtonLabel}
								onClick={handleToggleExcludedAccounts}
							>
								{showExcludedAccounts ? (
									<RiEyeOffLine className="size-4" aria-hidden />
								) : (
									<RiEyeLine className="size-4" aria-hidden />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent side="left" className="max-w-xs">
							<p className="text-xs">{toggleButtonLabel}</p>
							{!showExcludedAccounts ? (
								<p className="mt-1 text-xs text-background/70">
									{excludedAccountsCount}{" "}
									{excludedAccountsCount === 1
										? "conta não considerada oculta"
										: "contas não consideradas ocultas"}
								</p>
							) : null}
						</TooltipContent>
					</Tooltip>
				) : null}
			</div>

			<div>
				{activeAccounts.length === 0 ? (
					<WidgetEmptyState
						icon={
							<RiBarChartBoxLine className="size-6 text-muted-foreground" />
						}
						title="Você ainda não adicionou nenhuma conta"
						description="Cadastre suas contas bancárias para acompanhar os saldos e movimentações."
					/>
				) : displayedAccounts.length === 0 ? (
					<WidgetEmptyState
						icon={<RiEyeOffLine className="size-6 text-muted-foreground" />}
						title="As contas não consideradas estão ocultas"
						description="Use o botão no topo do widget para mostrá-las novamente."
					/>
				) : (
					<ul className="flex flex-col">
						{displayedAccounts.map((account, index) => {
							const logoSrc = resolveLogoSrc(account.logo);

							return (
								<li key={account.id} className={styles.row}>
									<div className={styles.main}>
										<div className="relative flex size-9.5 shrink-0 items-center justify-center overflow-hidden rounded-full">
											{logoSrc ? (
												<Image
													src={logoSrc}
													alt={`Logo da conta ${account.name}`}
													fill
													sizes="38px"
													className="object-contain rounded-full"
													priority={index === 0}
												/>
											) : (
												<span className="text-xs font-medium text-primary">
													{buildInitials(account.name)}
												</span>
											)}
										</div>

										<div className={styles.textStack}>
											<Link
												prefetch
												href={`/accounts/${
													account.id
												}/statement?periodo=${formatPeriodForUrl(period)}`}
												className={styles.titleLink}
											>
												<span className="truncate">{account.name}</span>
											</Link>

											<div className={styles.meta}>
												<span className="truncate">{account.accountType}</span>
												{account.excludeFromBalance ? (
													<Tooltip>
														<TooltipTrigger asChild>
															<span className="inline-flex cursor-help">
																<Badge className="font-normal" variant="info">
																	Não considerada
																</Badge>
															</span>
														</TooltipTrigger>
														<TooltipContent side="top" className="max-w-xs">
															<p className="text-xs">
																Esta conta aparece na lista, mas não entra no
																cálculo do saldo total.
															</p>
														</TooltipContent>
													</Tooltip>
												) : null}
											</div>
										</div>
									</div>

									<div className={styles.trailing}>
										<MoneyValues
											className={cn(
												styles.trailingValue,
												account.balance < 0 && "text-destructive",
											)}
											amount={account.balance}
										/>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{remainingCount > 0 ? (
				<CardFooter className="border-border/60 border-t pt-4">
					<Link
						href="/accounts"
						className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
					>
						+{remainingCount} contas não exibidas
						<RiArrowRightLine className="size-4" aria-hidden />
					</Link>
				</CardFooter>
			) : null}
		</>
	);
}
