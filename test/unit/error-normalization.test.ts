import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  ESPMAccessError,
  ESPMRateLimitError,
} from "@/server/integrations/espm/errors";
import {
  NonRetryableIntegrationError,
  NotFoundError,
  PacketRenderError,
  RetryableIntegrationError,
  toAppError,
  toHttpErrorResponseBody,
  toTrpcError,
} from "@/server/lib/errors";

describe("error normalization", () => {
  it("classifies ESPM rate limits as retryable integration errors", () => {
    const appError = toAppError(new ESPMRateLimitError("retry later"));

    expect(appError).toBeInstanceOf(RetryableIntegrationError);
    expect(appError.retryable).toBe(true);
    expect(appError.httpStatus).toBe(429);
  });

  it("classifies ESPM access failures as non-retryable integration errors", () => {
    const appError = toAppError(new ESPMAccessError("access denied"));

    expect(appError).toBeInstanceOf(NonRetryableIntegrationError);
    expect(appError.retryable).toBe(false);
    expect(appError.httpStatus).toBe(403);
  });

  it("maps not-found domain errors to NOT_FOUND tRPC errors", () => {
    const error = toTrpcError(new NotFoundError("Building not found"));

    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Building not found");
  });

  it("preserves packet render failures as internal packet errors", () => {
    const error = toTrpcError(
      new PacketRenderError("Packet PDF rendering failed."),
    );

    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toBe("Packet PDF rendering failed.");
  });

  it("produces safe HTTP error bodies with request IDs", () => {
    const response = toHttpErrorResponseBody(
      new PacketRenderError("Packet PDF rendering failed."),
      "req-123",
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Packet PDF rendering failed.",
      code: "PACKET_RENDER_ERROR",
      retryable: false,
      requestId: "req-123",
    });
  });
});
