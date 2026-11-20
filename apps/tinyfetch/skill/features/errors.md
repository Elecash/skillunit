# tinyfetch — errors

A status outside 200–299 throws an `HttpError` with the `status` and the parsed `body`. A timeout throws a `TimeoutError`, and a network failure throws what `fetch` threw.

Setup:

```ts
import { isHttpError, tf } from "tinyfetch";
```

## Rules

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
