---
name: fix-sonarqube-issues
description: >-
  Investigate and fix SonarQube or SonarJS findings, quality-gate failures,
  duplicated-code reports, security hotspots, or server/local rule drift. Not
  for an ordinary lint error with no Sonar finding.
---
# Fix SonarQube issues

1. Capture the rule ID, message, file, line, branch/PR context, and whether the
   finding came from the server, IDE, agent hook, or ESLint.
2. Read the surrounding implementation and tests. Diagnose the underlying risk
   instead of mechanically rewriting the highlighted line.
3. Prefer a small structural fix that preserves behavior and strengthens types
   or tests. Never add a blanket suppression, exclude a source path, or mark an
   issue false-positive without a concrete justification.
4. Add a regression test when the finding exposes behavioral risk.
5. Run the narrow test and typecheck first, then `npm run lint` and
   `npm run release:verify`.
6. For rule drift, authenticate with
   `sonar auth login --server https://sonar.casadega.dev`, run
   `npm run sonar:rules`, and commit the generated rule list with the profile
   change. Do not claim the local plugin reproduces analyzers it does not
   implement.

For a security hotspot, explain the trust boundary and mitigation. Leave the
server review status to an authorized human unless the user explicitly asks you
to change it.
