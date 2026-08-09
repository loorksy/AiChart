"""The automated bot engines — grid, DCA, martingale, layered martingale.

SIMULATION ONLY. Nothing in this package can reach a broker. The engine talks
to a `QuantBrokerPort` (`app.engine.bots.engine`), and the one and only
implementation of that port in this repository is `SimulatedQuantBroker`
(`app.engine.bots.simulated_broker`), which fills limit orders against bars
`web/` pushes in. `tests/test_no_execution.py` pins both halves of that claim:
no module here imports a network library, and no second implementation of the
port exists anywhere in the tree.

Wiring a real broker is therefore a deliberate future code change — a new class,
a new import, a new review — and never a configuration toggle.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger), Copyright
Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). See `quant-agent/NOTICE.md` for
the full list of upstream sources and the changes made on port.
"""

from __future__ import annotations
