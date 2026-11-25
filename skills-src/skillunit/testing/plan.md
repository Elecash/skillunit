# SkillUnit — planning the questions

Which questions a skill needs, where each one is declared, and what each request sends to the decision model.

A question is declared with its unit, in the `ask` of its `unit()`, and is about the file of the skill that holds the unit; a question about prose that belongs to no unit is declared with `ask()` and names its `file`. The test layer sends that file (or some of its headings, with `section`) to the decision model as the state, and asks each question about it. A question with `with` also sends other files of the skill, the ones an agent reads together with it. The questions about one file, with the same `section` and `with`, go in one request.

A failure shows the unit of the question and the line that declares it. `test --changed` asks the questions about the files that changed, and those whose `with` lists one.

## Rules

{{unit:question-with-its-unit}}

{{unit:section-for-long-files}}

{{unit:with-only-what-the-agent-reads}}

{{unit:list-the-decisions-first}}
