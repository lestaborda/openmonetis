export const TRANSACTION_TYPES = [
	"Despesa",
	"Receita",
	"Transferência",
] as const;

export const TRANSACTION_CONDITIONS = [
	"À vista",
	"Parcelado",
	"Recorrente",
] as const;

export const PAYMENT_METHODS = [
	"Cartão de crédito",
	"Cartão de débito",
	"Pix",
	"Dinheiro",
	"Boleto",
	"Pré-Pago | VR/VA",
	"Transferência bancária",
] as const;

export const CREDIT_CARD_PAYMENT_METHOD = "Cartão de crédito" as const;

export const SETTLEABLE_PAYMENT_METHODS = PAYMENT_METHODS.filter(
	(method) => method !== CREDIT_CARD_PAYMENT_METHOD,
);

export const SETTLED_FILTER_VALUES = {
	PAID: "pago",
	UNPAID: "nao-pago",
} as const;

export const SPLIT_MODES = {
	COST_SHARE: "cost_share",
	REIMBURSEMENT: "reimbursement",
} as const;

export type SplitMode = (typeof SPLIT_MODES)[keyof typeof SPLIT_MODES];

export const RECEIVABLE_FILTER_VALUE = "a-receber";

/** Meses criados ao salvar um lançamento recorrente sem seleção explícita. */
export const DEFAULT_RECURRENCE_COUNT = 60;
export const MAX_RECURRENCE_COUNT = 60;

export const AMOUNT_MIN_PARAM = "valorMin";
export const AMOUNT_MAX_PARAM = "valorMax";
export const DATE_START_PARAM = "dataInicio";
export const DATE_END_PARAM = "dataFim";
