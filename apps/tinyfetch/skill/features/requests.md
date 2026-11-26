# tinyfetch — requests

Send a request and read its response: the methods, query parameters and JSON bodies.

```ts
import { tf } from "tinyfetch";
```

## Rules

### fact: method-results

When: the code reads what a request resolves to.

Value: `get`, `post`, `put`, `patch` and `delete` resolve to the body of the response; `head` resolves to `undefined`.

### fact: response-body

When: a request resolves.

Value: a response whose `content-type` is JSON comes back parsed; any other comes back as text.

### rule: query-in-options

When: a request needs query parameters.

Do: pass them in the `query` option, which encodes each value.

Right:

```ts
await tf.get("https://api.example.com/users", {
  query: { page: 2, sort: "name" },
});
```

### rule: body-as-object

When: a request sends data.

Do: pass the object itself as the body; tinyfetch serializes it and sets `content-type`.

Right:

```ts
await tf.post("https://api.example.com/users", { name: "Ada" });
```
