# Gold Agent X Versioned Learning

Gold Agent X no longer learns online from a single closed `TradeJournalEntry`. Its Phase 4 learning
entry point reads only `RecommendationSucceeded`/`RecommendationFailed` events whose evidence was
explicitly validated and contains a direction plus bounded advisor votes.

The default proposal gates are:

- at least 20 validated recommendation results;
- at least 0.70 dominant-result confidence;
- at least the same sample threshold per advisor before that advisor changes;
- decay of 0.98 toward the prior weight;
- hard weight bounds of 0.3 to 2.0.

A proposal creates a `candidate` row in `gold_agent_weight_versions`. It does not mutate the input
weights or the running Agent X state. Activation is a separate server operation that rechecks the
fixed gates, retains the parent version and marks the previous active version rolled back. Rollback
explicitly reactivates a retained version. Version/evidence history is tenant and strategy scoped.

The live cycle does not invoke the prior optimizer or direct trade-learning function. Existing
decision, Risk Guard, Execution Guard, Market Sync Guard and broker behavior is unchanged. Phase 4
does not perform automatic activation, strategy generation or self-modifying code.
