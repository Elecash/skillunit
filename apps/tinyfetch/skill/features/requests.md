# tinyfetch — requests

What a request sends, and what its call resolves to.

```ts
import { tf } from "tinyfetch";
```

## Rules

### fact: methods

When: the code sends a request.

Value: a client has the methods `get`, `head`, `post`, `put`, `patch` and `delete`, and each sends the HTTP method of its name; `post`, `put` and `patch` take `(path, body, options)`, and `get`, `head` and `delete` take `(path, options)`.

### fact: request-options

When: the code passes options to a request.

Value: the options of a request are `headers`, `query`, `timeout`, `retry`, `retryDelay` and `signal`, and no other.

### rule: send-a-body

When: the code sends data with `post`, `put` or `patch`.

Do: pass the value itself as `body`, not `JSON.stringify(value)`: tinyfetch sends `JSON.stringify(body)`, so a string is sent as a quoted JSON string.

Right:

```ts
await tf.post("https://api.example.com/users", { name: "Ada" });
```

### fact: content-type

When: the code sets `content-type` in `headers`.

Value: a request with a body sends `content-type: application/json`, which replaces a `content-type` of `headers`, so tinyfetch sends no other kind of body; a request with no body sends the `content-type` of `headers` as it is, and none when it sets none.

### fact: headers

When: the code sets headers on a client or a request.

Value: a request sends `accept: application/json`, then the `headers` of its client, then its own: a later one replaces an earlier one of the same name, `accept` included.

### fact: query

When: the code passes `query`.

Value: each key of `query` is set on the query string of the URL, as `String(value)` and encoded; a key the path already has takes the new value, and the other keys of the path stay.

```ts
await tf.get("https://api.example.com/users", {
  query: { role: "admin", page: 2 },
});
```

### fact: response-value

When: the code uses what a call resolves to.

Value: a call resolves to the body parsed as JSON when the `content-type` of the response has `json` in it, to the text of the body when it does not, and to an empty string when the body is empty; `head` resolves to `undefined`.
