# tinyfetch — clients

Make many requests to one API through a client.

```ts
import { create } from "tinyfetch";
```

## Rules

### fact: client-options

When: the code creates a client with `create`.

Value: `baseUrl` is the prefix of every path, `headers` are sent with every request, and `timeout` is the timeout of every request that sets none; a request's own `timeout` wins.

```ts
const api = create({
  baseUrl: "https://api.example.com/v1/",
  headers: { authorization: "Bearer token" },
});
const orders = await api.get<{ id: number }[]>("orders");
console.log(orders.length);
```

### decision: one-client-per-api

When: the code makes several requests to the same API.

Decide: whether to create a client.

- **shared** — the requests share a base URL or headers: create one client with `create` and reuse it.

  ```ts
  const api = create({ baseUrl: "https://api.example.com/v1/" });
  await api.get("users");
  await api.get("orders");
  ```

- **direct** — one request, or requests to unrelated hosts: call `tf` with full URLs.

Even when: the requests sit in different files: export the client from one module and import it.
