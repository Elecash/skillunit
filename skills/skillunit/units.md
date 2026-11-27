# SkillUnit — files and units in tests

How a test declares the files of the skill and the units in them, and what the build makes of them.

```ts
setup('retries', { file: 'features/retries.md', title: 'Retries', when: 'Retry a request that failed', description: 'Which requests the client sends again.' });
unit('retry-delay', { when: 'a request is sent again.', value: `the client waits ${DEFAULT_RETRY_DELAY} ms before the first new attempt.`, values: { delay: DEFAULT_RETRY_DELAY } }, () => {
  expect(retryWaits(1)).toEqual([DEFAULT_RETRY_DELAY]);
});
```

## Rules

### rule: start-from-the-code

When: a skill is written, or its units are chosen.

Do: read the source of the code first, and list what an agent that writes code with it needs to know and can get wrong; then write a unit for each row of the list, or say why the row is left out.

Even when: the project has a skill or a README already: units copied from them say what the old text said, not what the code does.

### fact: setup-a-file

When: a test declares a file of the skill with `setup()`.

Value: `setup(id, spec)` declares a file of the skill; its spec takes `file`, `title`, `when`, `description` and `frontmatter`. `SKILL.md` needs `frontmatter`, the name and description of the skill, and takes no `when`. Any other file needs `when`: the task its row in the table of `SKILL.md` names. The text of a `setup()` has no number.

### fact: units-belong

When: a test file declares units and questions after a `setup()`.

Value: each unit and question belongs to the file of the last `setup()` before it in its test file, in the order they are declared. A unit with no `setup()` before it fails the build.

### decision: which-entry

When: a project declares the units of its skill in its tests.

Decide: where `unit()` comes from.

- **vitest** — the tests run on Vitest: import `and`, `ask`, `code`, `key`, `or`, `setup` and `unit` from `skillunit/vitest`.

- **other-runner** — another JavaScript runner: `createUnit(it)` from `skillunit/unit` gives `unit`, `ask` and `setup` for that runner's `it`.

- **other-language** — another language: each test writes its record itself, one JSON file per unit in `proof.units`, in version 2 of the contract, whose types `skillunit/unit` exports.

### rule: setup-text-from-code

When: a test writes the text of a `setup()`: the description of its file, the `when` of its row in the index, the description of the frontmatter.

Do: build each name of the code in it from the code, with `key()` or a `name`, as in the sentence of a unit, and declare what it uses before the `setup()`, which runs when the file loads.

Even when: the text is a short row of the index: one that said "…headers and query" kept `query` after the option and its unit were gone, and every check passed.

### fact: import-by-name

When: a test inside a package imports the package by its name, as the examples of the skill do.

Value: Node resolves the name of a package from inside it through the `exports` of its `package.json`, with no link in `node_modules`, and Vitest and TypeScript with `NodeNext` do the same. With `exports` pointing at the source, the tests run the code as it is, with no build and no alias.

### fact: unit-kinds

When: a test declares a unit with `unit(id, spec, body)`.

Value: the keys of its spec make the kind of a unit: `do` a rule, `value` a fact and `decide` with `paths` a decision. A spec with two of them is refused.

### fact: unit-spec

When: a test writes the spec of a unit.

Value: a spec takes `when`, `do`, `value`, `decide`, `paths`, `unknown`, `evenWhen`, `values` and `ask`, and no other key; every unit has `when`. `unknown` goes only with a fact and `evenWhen` goes only with a rule or a decision.

### fact: ids

When: a test gives the id of a file, a unit or a question.

Value: an id is kebab-case, such as `retry-delay`. Files and units share one space of ids, and each is declared once across the tests; so is each question id. A unit's first question takes the unit's id unless it gives `id`, and the next ones `<id>.2` and `<id>.3`.

### fact: body-asserts

When: the body of a unit makes no assertion.

Value: with `skillunit/vitest`, a body proves its unit when it makes an assertion or calls `u.value`. A body that only calls `u.example` builds its unit, counted as declared: no test proves it. A body that does none of the three fails its test, so its unit is not built.

### fact: no-body

When: a unit is something no test can state, such as advice.

Value: `unit(id, spec)` with no body declares a unit no test proves. The build writes it as it writes any unit, and the proof counts it as declared, not proved. A fact with no body gives `value` in its spec. A unit with no body shows no block, since only a body calls `u.example`; a body that only shows blocks is how advice shows one.

### fact: u-value

When: the body of a fact goes through a list of cases and says which did what.

Value: `u.value(text)` in a body sets the value of a fact from what the body found, in place of `value` in the spec. A rule or a decision refuses it.

### rule: sentence-and-assertion

When: a test writes the sentence of a fact about what the code does.

Do: put the sentence in `value`, its numbers from constants and its names from the types, and assert in the body what it says. Build it with `u.value()` only when the body goes through a list of cases and the sentence says which did what; its words then come from that list or from a constant, never from an outcome the code does not have.

Even when: a sentence built from the outcome would be shorter to write: a test that goes red when the behaviour changes is what tells a regression from a change that is meant.

### fact: u-example

When: the body of a unit produces a block worth showing: a command, a config, an output.

Value: `u.example(lang, text)` adds a fenced block the body produced, after the unit's regions: under `Right:` in a rule, and under the value of a fact. A decision refuses it. `u.example` is no assertion: with one, as above, the unit is proved; with none, the unit is built and counted as declared, in the proof's summary and in every report.

```ts
unit('install-the-server', { when: 'the server is not installed.', do: 'run it with `npx`, so nothing is installed for good.' }, (u) => {
  const config = { servers: { example: { command: 'npx', args: ['-y', pkg.name] } } };
  expect(pkg.bin).toBeDefined(); // `npx` can run the package
  u.example('bash', `npx -y ${pkg.name}`);
  u.example('json', JSON.stringify(config, null, 2));
});
```

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

Value: `exportNames(entry)` from `skillunit/typescript` gives the names a TypeScript file exports, as the compiler sees them, `values` and `types` apart: a class exported with `export type` is a type, and `export *` brings the names of its module. It takes a path or a `file:` URL, and resolves modules with the `tsconfig.json` above the file, its `paths` included. It uses the project's `typescript` when that package has the compiler API, and SkillUnit's own when it does not, as with TypeScript 7, which exports only its version from `typescript`: nothing to install.

### fact: key

When: a sentence names a key of a type of the code: an option, a method, a field.

Value: `key<T>(name)` from `skillunit/vitest` or `skillunit/unit` returns `name` and accepts only a key of `T`, so a key renamed in the code fails the type-check of each test that still names it. With the type of a module, `key<typeof Module>(name)` after `import type * as Module from '<library>'`, it accepts only a name the module exports, so a renamed export fails the same way.

### fact: text-helpers

When: a sentence lists names or values the body read.

Value: `and(items)` and `or(items)`, from `skillunit/vitest` or `skillunit/unit` next to `key`, join a list as a sentence does: `and(['a', 'b', 'c'])` is "a, b and c", and `or` joins the last two with "or". `code(items)` puts each item in backticks, so `and(code(['retry', 'timeout']))` is `retry` and `timeout`.

### rule: say-no-more

When: a test writes the sentence of a unit with a body.

Do: write no more than the body checks: "every", "any", "always" and "never" need a body that goes through every case, or the sentence names the cases the body tried.

Even when: the sentence is what the docs of the code say: a body that tries one form proves that form only.

### rule: example-is-library-code

When: a test marks a region for the skill.

Do: put in it only the code an agent would write with the library: no assertion, no helper of the test, no fake server.

Even when: the whole test would show that the example works: set up before the `#region` line, and assert after `#endregion`.

### rule: type-check-the-tests

When: the tests of the skill use `key()` or an object typed against a type of the code.

Do: start `proof.run` with a type-check that includes the test files, as `npx tsc --noEmit && npx vitest run skill.test`: a key renamed in the code fails there, and only there.

Even when: the tests pass: a test run that strips the types, as Vitest does, does not check them.
