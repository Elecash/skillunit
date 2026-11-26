# tinyfetch — retries

Which failed requests tinyfetch sends again, how often, and how long it waits in between.

```ts
import { tf } from "tinyfetch";
```

## Rules

### fact: retry-count

When: a request sets `retry`, or sets none.

Value: `retry` is how many more attempts tinyfetch makes after the first one fails; it is 0 by default, so a failed request is not sent again.

### fact: retry-delay

When: a request with `retry` fails and is sent again.

Value: before the first new attempt tinyfetch waits `retryDelay`, 300 ms by default, and before each next one 2x the wait before it.

```ts
const users = tf.get("https://api.example.com/users", {
  retry: 3,
  retryDelay: 1_000,
});
```

### fact: what-is-retried

When: a request with `retry` fails.

Value: a network error and a status of 500 or above with any body are retried; a status under 500, a timeout, an abort and an `ok` response that says it is JSON and does not parse never are.

### fact: retry-any-method

When: the code passes `retry` to a request.

Value: `retry` sends a request again whatever its method, `get`, `head`, `post`, `put`, `patch` and `delete` alike: tinyfetch does not check whether a method is safe to repeat.

### rule: retry-idempotent-only

When: the code adds `retry` to a request.

Do: pass `retry` only to GET, HEAD, PUT and DELETE, which a server can receive twice with the same result; leave it off POST and PATCH, where a repeated request can create or change something twice.

Even when: the network drops now and then, or the API answers 503 now and then; tinyfetch sends a POST again like any other request, so only the code keeps it from being sent twice.
