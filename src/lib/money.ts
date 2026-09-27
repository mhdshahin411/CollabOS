import type { Deal } from "@/lib/types";

/** A deal's ISO 4217 currency; deals without one are stored as USD. */
export function dealCurrency(deal: Pick<Deal, "currency">): string {
  return deal.currency?.trim().toUpperCase() || "USD";
}

/** Formats an amount in its own currency; `compact` abbreviates six figures and up. */
export function formatMoney(amount: number, currency: string, { compact = false } = {}): string {
  const short = compact && amount >= 100_000;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: short ? "compact" : "standard",
      maximumFractionDigits: short ? 1 : 0,
    }).format(amount);
  } catch {
    // Not a code Intl knows.
    return `${amount.toLocaleString("en-US")} ${currency}`;
  }
}

export function formatBudget(deal: Deal): string | null {
  return deal.budget == null ? null : formatMoney(deal.budget, dealCurrency(deal));
}

export interface CurrencyTotal {
  currency: string;
  total: number;
  count: number;
}

/**
 * Budgets summed per currency (amounts in different currencies can't be added
 * together), most-used currency first. Deals without a budget are skipped.
 */
export function totalsByCurrency(deals: Deal[]): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const deal of deals) {
    if (deal.budget == null) continue;
    const currency = dealCurrency(deal);
    const entry = totals.get(currency) ?? { currency, total: 0, count: 0 };
    entry.total += deal.budget;
    entry.count += 1;
    totals.set(currency, entry);
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || b.total - a.total);
}
