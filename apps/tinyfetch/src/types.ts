/** Options of one request. */
export interface RequestOptions {
  /** Extra headers. tinyfetch sets `content-type` and `accept` for JSON itself. */
  headers?: Record<string, string>;
  /** Query parameters, encoded and appended to the path. */
  query?: Record<string, string | number | boolean>;
  /** Milliseconds before the request is aborted with a TimeoutError. Default `DEFAULT_TIMEOUT`; `NO_TIMEOUT` turns it off. */
  timeout?: number;
  /** Extra attempts after the first one, on a network error or a status of `RETRIED_STATUS` or above. Default `DEFAULT_RETRY`. */
  retry?: number;
  /** Milliseconds to wait before the first new attempt; each next wait is `RETRY_TIMES` times the one before. Default `DEFAULT_RETRY_DELAY`. */
  retryDelay?: number;
  /** Cancels the request, and any attempt still to come. */
  signal?: AbortSignal;
}

/** Options of a client: shared by every request it makes. */
export interface ClientOptions {
  /** Prefix of every path that is not a whole URL, such as `https://api.example.com/v1`. */
  baseUrl?: string;
  headers?: Record<string, string>;
  /** The timeout of every request the client makes; a request's own `timeout` wins. */
  timeout?: number;
}
