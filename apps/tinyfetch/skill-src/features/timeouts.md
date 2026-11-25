# tinyfetch — timeouts and cancelling

Every request has a timeout, and any request can be cancelled with an `AbortSignal`.

Setup:

```ts
import { tf, TimeoutError } from "tinyfetch";
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `timeout` | number (ms) | `{{value:default-timeout.ms}}` | abort the request after this long; `0` turns the timeout off |
| `signal` | AbortSignal | none | cancel the request, and any retry still to come |

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

{{unit:default-timeout}}

{{unit:never-disable-timeout}}
