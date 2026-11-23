# tinyfetch — requests

Send a request and read its response: the six methods, query parameters and JSON bodies.

Setup:

```ts
import { tf } from "tinyfetch";
```

## Methods

| Method | Call                            | Resolves to     |
| ------ | ------------------------------- | --------------- |
| GET    | `tf.get(path, options)`         | the parsed body |
| HEAD   | `tf.head(path, options)`        | nothing         |
| POST   | `tf.post(path, body, options)`  | the parsed body |
| PUT    | `tf.put(path, body, options)`   | the parsed body |
| PATCH  | `tf.patch(path, body, options)` | the parsed body |
| DELETE | `tf.delete(path, options)`      | the parsed body |

The type parameter names the shape the code expects:

```ts
const user = await tf.get<{ id: number; name: string }>(
  "https://api.example.com/users/1",
);
console.log(user.name);
```

## Rules

### fact: response-body

When: a request resolves.

Value: a response whose `content-type` is JSON comes back parsed; any other comes back as text.

Applies: requests

### rule: query-in-options

When: a request needs query parameters.

Do: pass them in the `query` option, which encodes each value.

Right:

```ts proof=query-in-options
await tf.get("https://api.example.com/users", {
  query: { page: 2, sort: "name" },
});
```

Wrong:

- Doing: building the query string by hand.

  Because: a value with a space, `&` or `#` breaks the URL, and nothing encodes it.

  ```ts
  const page = 2;
  await tf.get("https://api.example.com/users?page=" + page);
  ```

Applies: requests, query

Check: forbid `/\.(get|head|post|put|patch|delete)(<[^>]*>)?\(\s*["'][^"']*\?/` in ts

Source: src/request.ts

### rule: body-as-object

When: a request sends data.

Do: pass the object itself as the body; tinyfetch serializes it and sets `content-type`.

Right:

```ts proof=body-as-object
await tf.post("https://api.example.com/users", { name: "Ada" });
```

Wrong:

- Doing: `tf.post("https://api.example.com/users", JSON.stringify({ name: "Ada" }))`

  Because: the server receives a JSON string instead of an object.

Applies: requests, post, put, patch

Check: forbid `/JSON\.stringify/` in ts

Source: src/request.ts
