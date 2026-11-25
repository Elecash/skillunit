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

{{unit:response-body}}

{{unit:query-in-options}}

{{unit:body-as-object}}
