# tinyfetch — clients

What a client made with `create` shares between its requests.

```ts
import { create } from "tinyfetch";
```

## Rules

### fact: client-options

When: the code makes a client with `create`.

Value: `create(options)` makes a client whose requests share the options `baseUrl`, `headers` and `timeout`; `tf` is a client made with none, and `tf.create` is `create`.

### fact: base-url

When: the code sets `baseUrl`, or calls a client with a path.

Value: a path that is not a whole URL goes after `baseUrl`, with one `/` between them, whether or not `baseUrl` ends with `/` and whether or not the path starts with one; a whole URL, such as `https://other.example.com/x`, is sent as it is; a client with no `baseUrl`, `tf` among them, sends `/users` to `http://localhost/users`.

```ts
const api = create({ baseUrl: "https://api.example.com/v1" });
await api.get("/users");
```
