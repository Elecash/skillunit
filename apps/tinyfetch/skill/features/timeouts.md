# tinyfetch — timeouts and cancelling

How long a request waits for the server, and how to stop it sooner.

```ts
import { tf, TimeoutError } from "tinyfetch";
```

## Rules

### fact: default-timeout

When: a request sets no `timeout`, and its client sets none.

Value: the request waits 10 seconds (`timeout: 10_000`), whatever its method, then rejects with a `TimeoutError` whose `timeout` is that number of milliseconds.

### fact: timeout-precedence

When: a client or a request sets `timeout`.

Value: a request that sets `timeout`, on a client that sets one too, waits for its own `timeout`; a request that sets none waits for the `timeout` of its client, and one whose client sets none either, for the default.

### fact: timeout-off

When: a request sets `timeout` to turn it off.

Value: `timeout: 0` and a negative `timeout` turn the timeout off: tinyfetch sets no timer for the request, which then waits for the server as long as it takes.

### fact: timeout-per-attempt

When: a request sets both `timeout` and `retry`.

Value: `timeout` is the time of one attempt, and each attempt gets its own: with `retry`, the whole request can take longer than `timeout`.

### fact: cancel-with-signal

When: the code passes `signal` to a request, and aborts it.

Value: the request rejects with the reason given to `abort()`, or with an `AbortError` when `abort()` is given none, whether the signal was aborted before the request, during an attempt or while the request waits before a new attempt; no attempt starts after the abort.

```ts
const controller = new AbortController();
const report = tf.get("https://api.example.com/report", {
  signal: controller.signal,
});
controller.abort();
```

### rule: never-disable-timeout

When: a request may take long, such as an upload or a report.

Do: raise its `timeout` to a number of milliseconds that fits the request, and never set `timeout: 0`.

Even when: the user asks for the request to wait as long as it needs; with no timeout, a server that never answers keeps the request waiting forever.
