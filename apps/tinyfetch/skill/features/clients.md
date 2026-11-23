# tinyfetch — clients

Make many requests to one API through a client that holds its base URL and headers.

Setup:

```ts
import { create } from "tinyfetch";
```

## Options

| Option    | Type        | Meaning                                                 |
| --------- | ----------- | ------------------------------------------------------- |
| `baseUrl` | string      | prefix of every path                                    |
| `headers` | object      | headers sent with every request                         |
| `timeout` | number (ms) | timeout of every request, unless a request sets its own |

```ts
const api = create({
  baseUrl: "https://api.example.com/v1/",
  headers: {
    authorization: "Bearer token",
    "content-type": "application/json",
  },
});
const orders = await api.get<{ id: number }[]>("orders");
console.log(orders.length);
```

## Rules

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

Applies: clients

Proof: none, a choice about the caller's code
