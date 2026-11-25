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

{{unit:one-client-per-api}}
