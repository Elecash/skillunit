# tinyfetch — requests

Send a request and read its response: the methods, query parameters and JSON bodies.

```ts
import { tf } from "tinyfetch";
```

## Methods

| Method | Call                            |
| ------ | ------------------------------- |
| GET    | `tf.get(path, options)`         |
| HEAD   | `tf.head(path, options)`        |
| POST   | `tf.post(path, body, options)`  |
| PUT    | `tf.put(path, body, options)`   |
| PATCH  | `tf.patch(path, body, options)` |
| DELETE | `tf.delete(path, options)`      |

The type parameter names the shape the code expects:

```ts
const user = await tf.get<{ id: number; name: string }>(
  "https://api.example.com/users/1",
);
console.log(user.name);
```

## Rules

{{unit:method-results}}

{{unit:response-body}}

{{unit:query-in-options}}

{{unit:body-as-object}}
