# tinyfetch — retries

tinyfetch can repeat a request that failed. Which failures it repeats, and how long it waits, are in the rules below.

Setup:

```ts
import { tf } from "tinyfetch";
```

## Options

| Option       | Type        | Default | Meaning                                              |
| ------------ | ----------- | ------- | ---------------------------------------------------- |
| `retry`      | number      | 0       | extra attempts after the first one                   |
| `retryDelay` | number (ms) | 300     | wait before the first new attempt, doubled each time |

```ts
await tf.get("https://api.example.com/users", { retry: 3, retryDelay: 500 });
```

## Rules

### fact: retry-defaults

When: a request sets no `retry`, or no `retryDelay`.

Value: `retry` is 0, so a failed request is not repeated; `retryDelay` is 300 ms before the first new attempt, doubled before each next one.

### fact: what-is-retried

When: a request with `retry` fails.

Value: a network error and a 5xx status are retried; a 4xx status and a timeout never are.

### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```

Check: forbid `/\.(post|patch)\([^)]*retry/` in ts
