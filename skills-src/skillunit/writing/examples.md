# SkillUnit — code examples

How to write the code in a skill so lint can check it against the current API.

Agents copy examples before they read rules, so an example that breaks a rule or no longer compiles teaches the mistake. Lint type-checks every `ts`, `tsx`, `js` and `jsx` block with the project's own `tsc`, after the file's `Setup` block of the same language. A `tsx` block uses the `tsx` Setup, or the `ts` one when the file has none. A file with no `Setup` of its own for a language uses the one of the nearest `SKILL.md` above it that has one, up to the skill folder. Blocks in other languages run through a command, when `skillunit.yaml` sets one.

```yaml
examples:
  ts: { tsconfig: ./tsconfig.json }
  py: { command: "PYTHONPATH=src python3 {file}" }
```

A command runs on a copy of the example in a temporary folder, so `python3 -m py_compile {file}` checks the syntax only, and an import of a name the library no longer has passes. `PYTHONPATH=src python3 {file}`, with `src` the folder that holds the package, imports the library and runs the example.

The tsconfig named in `examples.ts` resolves the library's own name, usually with a `paths` entry, so an example's import reaches the current source. Without `examples.ts`, lint skips those blocks and says how many it skipped. Types that only generated code has, such as a Prisma client or a TanStack Router route tree, come from the tsconfig too: it includes the generated code, or a small fixture checked in for it, and the `Setup` imports it; a `Setup` cannot write them.

## Rules

{{unit:setup-once-per-file}}

{{unit:setup-per-version}}

{{unit:complete-examples}}

{{unit:short-complete-examples}}

{{unit:signatures-in-tables}}

{{unit:language-on-every-example}}

{{unit:no-check-rarely}}
