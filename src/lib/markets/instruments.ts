export interface ForexInstrument {
  symbol: string;
  base: string;
  quote: string;
}

export async function searchForexInstruments(
  _query: string,
  _limit = 200,
): Promise<ForexInstrument[]> {
  return [];
}
