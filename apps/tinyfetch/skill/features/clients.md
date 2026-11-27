# tinyfetch — clients

What a client made with `create` shares between its requests.

```ts
import { create } from "tinyfetch";
```

## Rules

### fact: client-options

When: the code makes a client with `create`.

Value: `create` makes a client whose requests share the options `baseUrl`, `headers` and `timeout`, as in the example; `tf` is a client made with none, and `tf.create` is `create`.

```ts
const api = create({
  baseUrl: "https://api.example.com",
  headers: { "x-team": "a" },
  timeout: 1_000,
});
```

### fact: base-url

When: the code sets `baseUrl`, or calls a client with a path.

Value: a path that is not a whole URL goes after `baseUrl`, with one `/` between them, whether or not `baseUrl` ends with `/` and whether or not the path starts with one; a whole URL, such as `https://other.example.com/x`, is sent as it is; a client with no `baseUrl`, `tf` among them, sends `/users` to `http://localhost/users`.

```ts
const api = create({ baseUrl: "https://api.example.com/v1" });
await api.get("/users");
```

### rule: no-query-in-base-url

When: a key or another query parameter goes on every request of a client.

Do: pass it in the `query` of each request, or in the `headers` of the client when the API takes it as a header; never put it at the end of `baseUrl`. A path is joined after the whole of `baseUrl` as text: with `baseUrl: "https://api.example.com/v1?api_key=K"`, `get("/users")` goes to `/v1` with `api_key` set to `K/users`.

Even when: the user asks for the key to be set once, on the client: a client takes `baseUrl`, `headers` and `timeout`, and no `query`.
