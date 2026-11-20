/** Options of one request. */
export interface RequestOptions {
  /** Extra headers. tinyfetch sets `content-type` and `accept` for JSON itself. */
  headers?: Record<string, string>;
  /** Query parameters, encoded and appended to the path. */
  query?: Record<string, string | number | boolean>;
  /** Milliseconds before the request is aborted with a TimeoutError. Default 10000. */
  timeout?: number;
  /** Extra attempts after the first one, on a network error or a 5xx status. Default 0. */
  retry?: number;
  /** Milliseconds to wait before the first new attempt, doubled each time. Default 300. */
  retryDelay?: number;
  /** Cancels the request, and any attempt still to come. */
  signal?: AbortSignal;
}

/** Options of a client: shared by every request it makes. */
export interface ClientOptions {
  /** Prefix of every path, such as `https://api.example.com/v1`. */
  baseUrl?: string;
  headers?: Record<string, string>;
  timeout?: number;
}
