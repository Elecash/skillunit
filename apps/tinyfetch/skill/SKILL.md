---
name: tinyfetch
description: Make HTTP requests to JSON APIs with tinyfetch. Use when code calls an HTTP API through tinyfetch, or when the user asks for retries, timeouts or error handling on such calls.
---

# tinyfetch

tinyfetch is a small HTTP client for JSON APIs, built on `fetch`.

```ts
import { tf } from "tinyfetch";
```

## Where to look

| Task                                                      | File                                         |
| --------------------------------------------------------- | -------------------------------------------- |
| Make many requests to one API with a client               | [features/clients.md](features/clients.md)   |
| Handle a request that failed                              | [features/errors.md](features/errors.md)     |
| Send a request: its method, path, body, headers and query | [features/requests.md](features/requests.md) |
| Retry a request that failed                               | [features/retries.md](features/retries.md)   |
| Time out or cancel a request                              | [features/timeouts.md](features/timeouts.md) |

## Rules

### fact: exports

When: the code imports from tinyfetch.

Value: `tinyfetch` exports `HttpError`, `TimeoutError`, `create`, `isHttpError` and `tf`, and the types `Client`, `ClientOptions` and `RequestOptions`.

### rule: await-every-request

When: the code calls a method of a client.

Do: `await` the call, or return its promise: every method returns a promise, and the value is what it resolves to.

Right:

```ts
const user = await tf.get<{ name: string }>("https://api.example.com/users/1");
console.log(user.name);
```
