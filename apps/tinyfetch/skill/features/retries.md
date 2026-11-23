# tinyfetch — retries

tinyfetch can repeat a request that failed. Which failures it repeats, and how long it waits, are in the rules below.

Setup:

```ts
import { tf } from "tinyfetch";
```

## Options

| Option       | Type        | Meaning                                              |
| ------------ | ----------- | ---------------------------------------------------- |
| `retry`      | number      | extra attempts after the first one                   |
| `retryDelay` | number (ms) | wait before the first new attempt, doubled each time |

```ts
await tf.get("https://api.example.com/users", { retry: 3, retryDelay: 500 });
```

## Rules

### fact: retry-defaults

When: a request sets no `retry`, or no `retryDelay`.

Value: `retry` is 0, so a failed request is not repeated; `retryDelay` is 300 ms before the first new attempt, doubled before each next one.

Applies: retries

### fact: what-is-retried

When: a request with `retry` fails.

Value: a network error and a 5xx status are retried; a 4xx status and a timeout never are.

Applies: retries, errors

### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```

Wrong:

- Doing: `tf.post("https://api.example.com/orders", { item: 42 }, { retry: 3 })`

  Because: a retried POST can create the same order twice.

Applies: retries, post, patch

Check: forbid `/\.(post|patch)\([^)]*retry/` in ts

Source: src/retry.ts

Proof: none, it is about what a server does with a repeated request, which the tests of tinyfetch cannot see
