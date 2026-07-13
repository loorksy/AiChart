from __future__ import annotations

from dataclasses import dataclass

from .models import Position, Side
from .policies import SymbolMetadata


@dataclass(slots=True)
class Account:
    account_currency: str
    leverage: float
    initial_capital: float
    balance: float
    equity: float
    used_margin: float = 0.0
    free_margin: float = 0.0
    realized_pnl: float = 0.0
    unrealized_pnl: float = 0.0
    peak_equity: float = 0.0
    drawdown: float = 0.0

    @classmethod
    def create(cls, currency: str, leverage: float, capital: float) -> Account:
        return cls(
            currency, leverage, capital, capital, capital, free_margin=capital, peak_equity=capital
        )

    def mark(
        self,
        positions: list[Position],
        prices: dict[str, float],
        metadata: dict[str, SymbolMetadata],
    ) -> None:
        unrealized = 0.0
        margin = 0.0
        for position in positions:
            meta = metadata[position.symbol]
            if meta.quote_currency != self.account_currency:
                raise ValueError("currency conversion data required for account marking")
            direction = 1 if position.side == Side.LONG else -1
            price = prices[position.symbol]
            unrealized += (
                (price - position.entry_price)
                * direction
                * position.remaining_size
                * meta.contract_size
            )
            margin += position.remaining_size * meta.contract_size * price / self.leverage
        self.unrealized_pnl = unrealized
        self.used_margin = margin
        self.equity = self.balance + unrealized
        self.free_margin = self.equity - margin
        self.peak_equity = max(self.peak_equity, self.equity)
        self.drawdown = self.peak_equity - self.equity

    def realize(self, amount: float) -> None:
        self.realized_pnl += amount
        self.balance += amount
        self.equity += amount
        self.peak_equity = max(self.peak_equity, self.equity)
        self.drawdown = self.peak_equity - self.equity
