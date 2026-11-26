# tinyfetch — errors

A request that fails throws. What it throws depends on how it failed, and the rules below say how to tell.

```ts
import { isHttpError, tf } from "tinyfetch";
```

## Rules

{{unit:what-a-failed-request-throws}}

{{unit:check-with-is-http-error}}
