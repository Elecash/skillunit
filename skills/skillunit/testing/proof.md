# SkillUnit — building the skill

How the skill folder follows the tests, and what to do when the proof fails.

## Rules

### rule: edit-the-test-not-the-skill

When: the agent changes the text of a skill that SkillUnit builds.

Do: edit the test that declares the unit, or the `setup()` of its file, then run `npx skillunit proof --write`; never edit the skill folder by hand.

Even when: the fix is one word; the next build undoes it, and `npx skillunit proof` fails until then.

### rule: rebuild-after-the-code-moved

When: `npx skillunit proof` reports that a line of the skill is not what the build gives, after a change to the code.

Do: read the line the build gives; when it says what the code now does, run `npx skillunit proof --write` and commit the built skill with the change.

Even when: the tests pass; a sentence built from the code changes without any test failing, and the difference in the skill is the signal.

### rule: fix-the-unit-when-its-test-fails

When: the test of a unit fails after a change to the code.

Do: read the change; when the code is right, correct the assertions of the test. When its sentence or its assertion has the value as a literal, give the value a name in the code and build both from that name, then run `npx skillunit proof` again.

Even when: skipping the test would make the test run pass; the skill would then have a unit no test declares, and the proof fails on it.

### rule: keep-the-unit-until-it-is-meant-to-go

When: `npx skillunit proof` reports a unit the skill has and no test declares.

Do: bring back the test that declared it; run `npx skillunit proof --write` to take the unit out only when it is no longer meant to be in the skill, and declare it with no body when it became advice.

Even when: `--write` would make the proof pass at once; it would also delete a unit whose test was lost by mistake, which is what the report is there to catch.
