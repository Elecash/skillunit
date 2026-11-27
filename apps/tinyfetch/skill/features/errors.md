# tinyfetch — errors

What a failed request rejects with, and how to tell one failure from another.

```ts
import { isHttpError, tf } from "tinyfetch";
```

## Rules

### fact: what-a-failed-request-throws

When: a request fails, or the server answers it with a status.

Value: a response with a status from 200 to 299 resolves; any other status rejects with an `HttpError` whose `status` is the status and whose `body` is the body parsed as JSON when it says it is JSON and parses, and its text when it does not; a request that gets no response rejects with the error `fetch` threw, such as a `TypeError`; an `ok` response that says it is JSON and does not parse rejects with the `SyntaxError` of the parse. A request with `retry` whose every attempt fails rejects the same way, with the error of its last attempt: an `HttpError` for a status, the error of `fetch` for no response.

### rule: is-http-error

When: the code catches the error of a request.

Do: test it with `isHttpError(error)`, not `instanceof HttpError`: `isHttpError` is also true for an `HttpError` of another copy of tinyfetch, and it is false for a `TimeoutError`, a `TypeError` of the network, `null`, and an object with a `status` that is not an `Error`.

Right:

```ts
try {
  return await tf.get("https://api.example.com/users/9");
} catch (error) {
  if (isHttpError(error) && error.status === 404) return null;
  throw error;
}
```
