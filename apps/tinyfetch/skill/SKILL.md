---
name: tinyfetch
description: Make HTTP requests to JSON APIs with tinyfetch. Use when code calls an HTTP API through tinyfetch, or when the user asks for retries, timeouts or error handling on such calls.
---

# tinyfetch

tinyfetch is a small HTTP client for JSON APIs, built on `fetch`. It sends bodies as JSON, parses JSON responses, and throws an `HttpError` for any status outside 200–299.

Setup:

```ts
import { tf } from "tinyfetch";
```

```ts
const users = await tf.get<{ id: number }[]>("https://api.example.com/users");
console.log(users.length);
```

## Where to look

| Task                                                               | File                                         |
| ------------------------------------------------------------------ | -------------------------------------------- |
| Send a request, read the response, pass query parameters or a body | [features/requests.md](features/requests.md) |
| Make many requests to one API                                      | [features/clients.md](features/clients.md)   |
| Retry a request that failed                                        | [features/retries.md](features/retries.md)   |
| Time out or cancel a request                                       | [features/timeouts.md](features/timeouts.md) |
| Handle a request that failed                                       | [features/errors.md](features/errors.md)     |

## Rules

### rule: await-every-request

When: the code calls a tinyfetch method.

Do: `await` the call, or return its promise: every method returns a promise of the parsed body.

Right:

```ts proof=await-every-request
const user = await tf.get<{ name: string }>("https://api.example.com/users/1");
console.log(user.name);
```

Wrong:

- Doing: `tf.get<{ name: string }>("https://api.example.com/users/1").name`

  Because: the call returns a promise, so `.name` is undefined.

Applies: requests

Source: src/client.ts
