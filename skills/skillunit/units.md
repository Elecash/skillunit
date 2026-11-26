# SkillUnit — files and units in tests

How a test declares the files of the skill and the units in them, and what the build makes of them.

```ts
setup('retries', { file: 'features/retries.md', title: 'Retries', when: 'Retry a request that failed', description: 'Which requests the client sends again.' });
unit('retry-delay', { when: 'a request is sent again.', values: { delay: DEFAULT_RETRY_DELAY } }, (u) => {
  expect(retryWaits(1)).toEqual([DEFAULT_RETRY_DELAY]);
  u.value(`the client waits ${DEFAULT_RETRY_DELAY} ms before the first new attempt.`);
});
```

## Rules

### fact: setup-a-file

When: a test declares a file of the skill with `setup()`.

Value: `setup(id, spec)` declares a file of the skill; its spec takes `file`, `title`, `when`, `description` and `frontmatter`. `SKILL.md` needs `frontmatter`, the name and description of the skill, and takes no `when`. Any other file needs `when`: the task its row in the table of `SKILL.md` names. The text of a `setup()` has no number.

### fact: units-belong

When: a test file declares units and questions after a `setup()`.

Value: each unit and question belongs to the file of the last `setup()` before it in its test file, in the order they are declared. A unit with no `setup()` before it fails the build.

### decision: which-entry

When: a project declares the units of its skill in its tests.

Decide: where `unit()` comes from.

- **vitest** — the tests run on Vitest: import `ask`, `key`, `setup` and `unit` from `skillunit/vitest`.

- **other-runner** — another JavaScript runner: `createUnit(it)` from `skillunit/unit` gives `unit`, `ask` and `setup` for that runner's `it`.

- **other-language** — another language: each test writes its record itself, one JSON file per unit in `proof.units`, in version 2 of the contract, whose types `skillunit/unit` exports.

### fact: unit-kinds

When: a test declares a unit with `unit(id, spec, body)`.

Value: the keys of its spec make the kind of a unit: `do` a rule, `value` a fact and `decide` with `paths` a decision. A spec with two of them is refused.

### fact: unit-spec

When: a test writes the spec of a unit.

Value: a spec takes `when`, `do`, `value`, `decide`, `paths`, `unknown`, `evenWhen`, `values`, `ask` and `examples`, and no other key; every unit has `when`. `unknown` goes only with a fact, `evenWhen` goes only with a rule or a decision and `examples` goes only with a rule or a fact.

### fact: ids

When: a test gives the id of a file, a unit or a question.

Value: an id is kebab-case, such as `retry-delay`. Files and units share one space of ids, and each is declared once across the tests; so is each question id. A unit's first question takes the unit's id unless it gives `id`, and the next ones `<id>.2`, `<id>.3`.

### fact: body-asserts

When: the body of a unit makes no assertion.

Value: with `skillunit/vitest`, a body that makes no assertion and calls neither `u.value` nor `u.example` fails its test, so its unit is not built. A unit that no test proves is declared with no body.

### fact: no-body

When: a unit is something no test can state, such as advice.

Value: `unit(id, spec)` with no body declares a unit no test proves. The build writes it as it writes any unit, and the proof counts it as declared, not proved. A fact with no body gives `value` in its spec.

### fact: u-value

When: the body of a fact observes the value it states.

Value: `u.value(text)` in a body sets the value of a fact from what the body observed, in place of `value` in the spec. A rule or a decision refuses it.

### fact: u-example

When: the body of a unit produces a block worth showing: an output, a config, a table.

Value: `u.example(lang, text)` adds a fenced block the body produced, after the unit's regions: under `Right:` in a rule, and under the value of a fact. A decision refuses it.

### fact: regions

When: a unit or a file of the skill shows code.

Value: the lines between `// #region skill:<id>` and `// #endregion` in a test file are an example: of the unit `<id>`; of the path `<path>` of a decision, as `skill:<id>.<path>`; or, with the id of a `setup()`, the code under the description of its file. The fence takes the language of the test file, such as `python` for a `.py` file, and each region id is in one place only.

### fact: number-rule

When: the text of a unit with a body has a number.

Value: a number in the text of a unit with a body must be one of its `values`, named in the spec, or its test fails; a unit with no body is not checked. A number is digits that do not follow a letter, a digit, `_` or `.`: `utf8` and `h2` have none, and `2x` has one.

### fact: failed-body

When: the body of a unit throws, or fails an assertion.

Value: its test fails and leaves no unit. The proof reports the test with its error, and leaves the file the unit belongs to as it is: it neither compares nor writes it.

### fact: export-names

When: a sentence names what a TypeScript file exports.

Value: `exportNames(entry)` from `skillunit/typescript` gives the names a TypeScript file exports, as the compiler sees them, `values` and `types` apart: a class exported with `export type` is a type, and `export *` brings the names of its module. It takes a path or a `file:` URL, and resolves modules with the `tsconfig.json` above the file, its `paths` included.

### fact: key

When: a sentence names a key of a type of the code: an option, a method, a field.

Value: `key<T>(name)` from `skillunit/vitest` or `skillunit/unit` returns `name` and accepts only a key of `T`, so a key renamed in the code fails the type-check of each test that still names it.
