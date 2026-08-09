"""Sandboxed-code strategy path (plan: sandbox parity request).

A second, additional generation mode alongside
`app.engine.strategies.generated` (the declarative DSL, which stays in
place unmodified). Here the LLM writes an actual `evaluate(features)`
Python function; it never runs directly — it must first pass
`app.sandbox.safe_exec.validate_code_safety` (AST/regex validation) and
then a compile/discovery dry run (`contract.compile_and_discover`) before
it is ever persisted, and even once persisted it stays `enabled=False`
until a human explicitly enables it. Every real evaluation call also runs
inside an isolated subprocess with a timeout — the same mechanism used at
discovery time (`contract.run_evaluate_in_sandbox`).
"""
