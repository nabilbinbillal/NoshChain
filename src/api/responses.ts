import type { ServerResponse } from "node:http";

export type ApiErrorBody = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiSuccessBody<T> = {
  success: true;
  data: T;
};

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  const payload = JSON.stringify(body, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );

  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

export function sendSuccess<T>(
  res: ServerResponse,
  status: number,
  data: T
): void {
  sendJson(res, status, { success: true, data } satisfies ApiSuccessBody<T>);
}

export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string
): void {
  sendJson(res, status, {
    success: false,
    error: { code, message },
  } satisfies ApiErrorBody);
}

export function containsPrivateKeyMaterial(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return (
      value.includes("BEGIN PRIVATE KEY") ||
      value.includes("BEGIN EC PRIVATE KEY") ||
      value.includes("BEGIN RSA PRIVATE KEY")
    );
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsPrivateKeyMaterial(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.privateKey === "string") {
      return true;
    }
    return Object.values(record).some((item) =>
      containsPrivateKeyMaterial(item)
    );
  }

  return false;
}
