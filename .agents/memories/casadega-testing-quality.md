# Testing quality

- Derive expected values from an independent source: the requested behavior, an API contract,
  documented policy, an existing caller, or a domain rule. Work out literal expectations from that
  source; do not copy the implementation's output, compute expectations by calling it, snapshot
  unverified output, or reimplement the same algorithm in the test. Label intentional legacy
  characterization tests as descriptions of current behavior rather than proof of correctness.
- Run relevant existing tests before changing their expectations. Presume an existing failure is a
  regression until a requested behavior change justifies the new expectation. Report each changed
  expectation with its old and new values and the request or contract authorizing the change.
- For bug fixes, first observe the narrow regression test fail against the unfixed behavior. For new
  behavior, falsify the important assertions with a reversible local source mutation as required by
  casadega-test-falsification. A green test derived only from newly written code is not an oracle.

- Test observable behavior, public contracts, failure modes, boundary values, and cleanup. A test
  that merely executes code, snapshots implementation detail, or calls a private helper cannot prove
  the production path is wired correctly.
- Keep the unit real and replace only external or lower-layer boundaries. Mock factories expose
  typed spies or preserve real exports; never reimplement production behavior inside a mock.
- Prefer exact public values and structural assertions. Prefix, substring, and negated-substring
  assertions can remain green for truncated, malformed, or partially leaked output.
- Isolate the behavior under examination by holding unrelated result-affecting inputs constant. Use
  deterministic clocks, randomness, identifiers, factories, and per-test state.
- Use a real local boundary when the mock framework cannot exercise the integration being claimed.
  Do not infer retry, transport, database, or serialization behavior from an incompatible double.
- Restore globals, timers, spies, subscriptions, listeners, servers, and temporary resources in the
  test that owns them. Do not use arbitrary sleeps, production services, or order-dependent state.
- Do not delete, skip, weaken, or broadly mock meaningful tests merely to make the suite pass.
  Resolve ambiguous competing contracts with the user.
- Preserve coverage ratchets and follow the shared casadega-test-falsification rule for regression,
  guard, rejection, and behavior-preserving-refactor tests.
