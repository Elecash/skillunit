# tinyfetch — timeouts and cancelling

How long a request waits, and how to cancel it.

```ts
import { tf, TimeoutError } from "tinyfetch";
```

## Rules

### fact: default-timeout

When: the user asks how long a request waits by default.

Value: 10 seconds (`timeout: 10_000`), for every method.

Unknown: tinyfetch has no separate connect timeout; say so instead of inventing one.

### fact: timeout-off

When: a request sets `timeout`.

Value: the request is aborted with a `TimeoutError` after that many milliseconds; a `timeout` of 0 turns the timeout off, and the request waits until the server answers.

```ts
try {
  await tf.get("https://api.example.com/slow", { timeout: 2_000 });
} catch (error) {
  if (error instanceof TimeoutError)
    console.log("gave up after", error.timeout, "ms");
}
```

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

### fact: cancel-with-signal

When: the code passes `signal` and aborts it.

Value: the request rejects with the reason the signal was aborted with.

```ts
const controller = new AbortController();
const report = tf.get("https://api.example.com/report", {
  signal: controller.signal,
});
controller.abort();
await report.catch(() => undefined);
```
