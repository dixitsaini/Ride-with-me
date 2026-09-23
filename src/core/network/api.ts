type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiRequestConfig = {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type ApiError = {
  status: number;
  message: string;
  body?: unknown;
};

export async function request<T>(
  url: string,
  config: ApiRequestConfig = {},
): Promise<T> {
  const response = await fetch(url, {
    method: config.method ?? "GET",
    body: config.body ? JSON.stringify(config.body) : undefined,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...config.headers,
    },
    signal: config.signal,
  });

  const responseBody = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const error: ApiError = {
      status: response.status,
      message: response.statusText || "Request failed",
      body: responseBody,
    };
    throw error;
  }

  return responseBody as T;
}
