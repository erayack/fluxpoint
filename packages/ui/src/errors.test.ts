import { describe, expect, it } from "vitest";
import { ApiClientError, getErrorMessage } from "./errors.js";

describe("getErrorMessage", () => {
  it("maps ApiErrorResponse codes to friendly messages", () => {
    const error = new ApiClientError(400, {
      code: "validation",
      message: "Validation failed",
    });

    expect(getErrorMessage(error)).toBe("Please check your input and try again.");
  });

  it("falls back to error message when code mapping is missing", () => {
    const error = new Error("Something else");

    expect(getErrorMessage(error)).toBe("Something else");
  });

  it("adds a label prefix when provided", () => {
    const error = new ApiClientError(404, {
      code: "not_found",
      message: "Missing",
    });

    expect(getErrorMessage(error, "Load failed")).toBe(
      "Load failed: The requested resource was not found.",
    );
  });
});
