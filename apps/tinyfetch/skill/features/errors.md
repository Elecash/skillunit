# tinyfetch — errors

A request that fails throws. What it throws depends on how it failed, and the rules below say how to tell.

Setup:

```ts
import { isHttpError, tf } from "tinyfetch";
```

## Rules

### fact: what-a-failed-request-throws

When: a tinyfetch call fails.

Value: a status outside 200–299 throws an `HttpError` with the `status` and the parsed `body`; a timeout throws a `TimeoutError`; a network failure throws what `fetch` threw.

Applies: errors

### rule: check-with-is-http-error

When: code catches an error from a tinyfetch call and reads its status.

Do: test the error with `isHttpError(error)` before reading `status` or `body`.

Right:

```ts proof=check-with-is-http-error
try {
  await tf.get("https://api.example.com/users/1");
} catch (error) {
  if (isHttpError(error) && error.status === 404) console.log("no such user");
  else throw error;
}
```

Wrong:

- Doing: reading `status` straight off the caught error.

  Because: the caught value may be a timeout or a network error, which has no status.

  ```ts
  try {
    await tf.get("https://api.example.com/users/1");
  } catch (error) {
    if (error.status === 404) console.log("no such user");
  }
  ```

Applies: errors

Source: src/errors.ts#isHttpError
