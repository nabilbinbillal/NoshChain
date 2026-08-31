import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "./logger.js";

const logger = createLogger("RateLimit");

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number = 15 * 60 * 1000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  private getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded && typeof forwarded === "string") {
      return forwarded.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  }

  checkLimit(req: IncomingMessage, res: ServerResponse): boolean {
    this.cleanupExpiredEntries();

    const ip = this.getClientIp(req);
    const now = Date.now();
    const entry = rateLimitStore.get(ip);

    if (!entry || entry.resetTime < now) {
      rateLimitStore.set(ip, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return true;
    }

    if (entry.count >= this.maxRequests) {
      logger.warn("Rate limit exceeded", {
        ip,
        path: req.url,
        method: req.method,
        count: entry.count,
        max: this.maxRequests,
      });

      this.sendRateLimitResponse(res, entry);
      return false;
    }

    entry.count++;
    return true;
  }

  private sendRateLimitResponse(res: ServerResponse, entry: RateLimitEntry): void {
    const retryAfter = Math.ceil((entry.resetTime - Date.now()) / 1000);

    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": retryAfter.toString(),
      "X-RateLimit-Limit": this.maxRequests.toString(),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": entry.resetTime.toString(),
    });

    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests, please try again later.",
          retryAfter,
        },
      })
    );
  }

  setRateLimitHeaders(res: ServerResponse, ip: string): void {
    const entry = rateLimitStore.get(ip);
    if (entry) {
      const remaining = Math.max(0, this.maxRequests - entry.count);
      const resetTime = Math.max(0, entry.resetTime - Date.now());

      res.setHeader("X-RateLimit-Limit", this.maxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", remaining.toString());
      res.setHeader("X-RateLimit-Reset", resetTime.toString());
    }
  }
}

export const strictRateLimiter = new RateLimiter(15 * 60 * 1000, 500);
export const standardRateLimiter = new RateLimiter(15 * 60 * 1000, 5000);
export const looseRateLimiter = new RateLimiter(15 * 60 * 1000, 10000);