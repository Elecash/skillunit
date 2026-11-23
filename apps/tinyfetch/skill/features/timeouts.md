# tinyfetch — timeouts and cancelling

Every request has a timeout, and any request can be cancelled with an `AbortSignal`.

Setup:

```ts
import { tf, TimeoutError } from "tinyfetch";
```

## Options

| Option    | Type        | Meaning                                                      |
| --------- | ----------- | ------------------------------------------------------------ |
| `timeout` | number (ms) | abort the request after this long; `0` turns the timeout off |
| `signal`  | AbortSignal | cancel the request, and any retry still to come              |

```ts
try {
  await tf.get("https://api.example.com/slow", { timeout: 2_000 });
} catch (error) {
  if (error instanceof TimeoutError)
    console.log("gave up after", error.timeout, "ms");
}
```

```ts
const controller = new AbortController();
const report = tf.get("https://api.example.com/report", {
  signal: controller.signal,
});
controller.abort();
await report.catch(() => undefined);
```

## Rules

### fact: default-timeout

When: the user asks how long a request waits by default.

Value: 10 seconds (`timeout: 10_000`), for every method.

Unknown: tinyfetch has no separate connect timeout; say so instead of inventing one.

Applies: timeouts

### rule: never-disable-timeout

When: a request may take long, such as an upload or a report.

Do: raise `timeout` to a number of milliseconds that fits the request, and never set it to `0`.

Right:

```ts
await tf.post(
  "https://api.example.com/uploads",
  { size: 1 },
  { timeout: 120_000 },
);
```

Applies: timeouts, uploads

Check: forbid `/timeout:\s*0\b/` in ts

Proof: none, advice on which timeout to choose
