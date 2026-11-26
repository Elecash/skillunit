# SkillUnit — planning the questions

Which questions a skill needs, and where each one is declared.

## Rules

### rule: question-with-its-unit

When: the agent writes a question about a rule of the skill.

Do: put it in the `ask` of the rule's `unit()`, so it is asked about the file that holds the unit; a question about something no unit says goes in `ask()`, after the `setup()` of the file it is about.

### rule: section-for-long-files

When: the file a question is about is long, above about 3,000 characters.

Do: give the question a `section`, the heading that states its rule, so the request sends only that part; a heading that is itself longer than that takes its subheading.

Even when: the file is short; then a question with no `section` reads it whole.

### rule: with-only-what-the-agent-reads

When: a rule reaches the agent from more than one file, and a mistake costs a lot.

Do: add a question whose `with` lists the files the agent reads for the task it describes, and keep the question without `with` too.

### rule: list-the-decisions-first

When: the agent is about to write the questions of a file.

Do: list the decisions the file forces, the places where an agent that read it acts differently from one that did not, and show the list to the user when they have not said which parts matter.

Even when: the file looks small; a sentence that changes nothing an agent does gets no question.
