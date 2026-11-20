# tinyfetch — retries

tinyfetch can repeat a request that failed with a network error or a 5xx status. It never retries a 4xx status or a timeout.

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
