# tinyfetch — errors

What a request that fails throws, and how to tell the errors apart.

```ts
import { isHttpError, tf } from "tinyfetch";
```

## Rules

### fact: what-a-failed-request-throws

When: a tinyfetch call fails.

Value: a response that is not `ok`, as `fetch` sets it, throws an `HttpError` with the `status` and the parsed `body`; a timeout throws a `TimeoutError`; a network failure throws what `fetch` threw.

### rule: check-with-is-http-error

When: code catches an error from a tinyfetch call and reads its status.

Do: test the error with `isHttpError(error)` before reading `status` or `body`.

Right:

```ts
try {
  await tf.get("https://api.example.com/users/1");
} catch (error) {
  if (isHttpError(error) && error.status === 404) console.log("no such user");
  else throw error;
}
```
