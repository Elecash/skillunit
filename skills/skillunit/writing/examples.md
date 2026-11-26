# SkillUnit — code examples

How to write the code in a skill.

Agents copy examples before they read rules, so an example that breaks a rule or no longer compiles teaches the mistake.

## Rules

### rule: complete-examples

When: the agent writes an example.

Do: make it compile on its own: declare every name it uses in the block.

### rule: signatures-in-tables

When: the agent shows a signature or the shape of an object rather than code to copy.

Do: put it in a table or in inline code.

Right:

```md
| Call | Resolves to |
| --- | --- |
| `tf.get(path, options)` | the parsed body |
```

### rule: language-on-every-example

When: the agent writes a fenced block under `Right` or a path of `Decide`.

Do: name its language after the opening fence, such as `ts`, `sh` or `yaml`.
