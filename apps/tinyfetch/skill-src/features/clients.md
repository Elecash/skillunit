# tinyfetch — clients

Make many requests to one API through a client that holds its base URL and headers.

```ts
import { create } from "tinyfetch";
```

## Options

| Option    | Type        |
| --------- | ----------- |
| `baseUrl` | string      |
| `headers` | object      |
| `timeout` | number (ms) |

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

{{unit:client-options}}

{{unit:one-client-per-api}}
