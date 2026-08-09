export function formatLevel(price: number | null): string {
  if (price == null) return "—";
  if (price >= 1000) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return price.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function formatTickerPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return price.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
