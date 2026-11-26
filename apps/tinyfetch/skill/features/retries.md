# tinyfetch — retries

tinyfetch can repeat a request that failed. Which failures it repeats, and how long it waits, are in the rules below.

```ts
import { tf } from "tinyfetch";
```

## Options

| Option       | Type        | Default | Meaning                                                                |
| ------------ | ----------- | ------- | ---------------------------------------------------------------------- |
| `retry`      | number      | 0       | extra attempts after the first one                                     |
| `retryDelay` | number (ms) | 300     | wait before the first new attempt; each next wait is 2x the one before |

```ts
await tf.get("https://api.example.com/users", { retry: 3, retryDelay: 500 });
```

## Rules

### fact: retry-defaults

When: a request sets no `retry`, or no `retryDelay`.

Value: `retry` is 0, so a failed request is not repeated; `retryDelay` is 300 ms before the first new attempt, and each next wait is 2x the one before.

### fact: what-is-retried

When: a request with `retry` fails.

Value: a network error and a status of 500 or above are retried; a status under 500 and a timeout never are.

### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```
