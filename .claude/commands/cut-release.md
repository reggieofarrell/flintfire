---
description: >-
  Cut a FlintFire release — preview version with release:bump:dry, get approval,
  then bump on a release branch and publish after merge.
---
# Cut Release

Read and follow the **releasing** skill (`.cursor/skills/releasing/SKILL.md`).

**First action:** run `npm run release:bump:dry`, present the Release preview template from the skill,
and **stop** until the user approves the version. Do not run `release:bump` or open a release PR
without that approval.
