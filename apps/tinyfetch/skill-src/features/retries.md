# tinyfetch — retries

tinyfetch can repeat a request that failed. Which failures it repeats, and how long it waits, are in the rules below.

Setup:

```ts
import { tf } from "tinyfetch";
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `retry` | number | {{value:retry-defaults.retry}} | extra attempts after the first one |
| `retryDelay` | number (ms) | {{value:retry-defaults.retry-delay}} | wait before the first new attempt, doubled each time |

```ts
await tf.get("https://api.example.com/users", { retry: 3, retryDelay: 500 });
```

## Rules

{{unit:retry-defaults}}

{{unit:what-is-retried}}

{{unit:retry-idempotent-only}}
