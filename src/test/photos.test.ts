import { describe, it, expect } from "vitest";
import {
  buildPhotoPath,
  extensionForContentType,
  isAllowedKind,
  jobIdFromPath,
} from "../../supabase/functions/_shared/photos";

describe("isAllowedKind", () => {
  it("accepts the three check-in photo slots", () => {
    expect(isAllowedKind("receipt")).toBe(true);
    expect(isAllowedKind("parts")).toBe(true);
    expect(isAllowedKind("job_site")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isAllowedKind("avatar")).toBe(false);
    expect(isAllowedKind("")).toBe(false);
    expect(isAllowedKind(null)).toBe(false);
    expect(isAllowedKind(42)).toBe(false);
  });
});

describe("extensionForContentType", () => {
  it("maps supported mime types to extensions (case-insensitive)", () => {
    expect(extensionForContentType("image/jpeg")).toBe("jpg");
    expect(extensionForContentType("IMAGE/PNG")).toBe("png");
    expect(extensionForContentType(" image/webp ")).toBe("webp");
    expect(extensionForContentType("application/pdf")).toBe("pdf");
  });

  it("returns null for unsupported or non-string types", () => {
    expect(extensionForContentType("image/gif")).toBeNull();
    expect(extensionForContentType("text/html")).toBeNull();
    expect(extensionForContentType(undefined)).toBeNull();
  });
});

describe("buildPhotoPath", () => {
  it("builds `${jobId}/${kind}/${uuid}.${ext}`", () => {
    expect(buildPhotoPath("job-1", "receipt", "image/jpeg", "uuid-1")).toBe("job-1/receipt/uuid-1.jpg");
    expect(buildPhotoPath("job-1", "job_site", "application/pdf", "uuid-2")).toBe("job-1/job_site/uuid-2.pdf");
  });

  it("throws on missing job, bad kind, or unsupported content type", () => {
    expect(() => buildPhotoPath("", "receipt", "image/jpeg", "u")).toThrow("missing_job");
    expect(() => buildPhotoPath("job-1", "bogus", "image/jpeg", "u")).toThrow("invalid_kind");
    expect(() => buildPhotoPath("job-1", "receipt", "image/gif", "u")).toThrow("unsupported_content_type");
  });
});

describe("jobIdFromPath", () => {
  it("returns the first path segment", () => {
    expect(jobIdFromPath("job-1/receipt/uuid.jpg")).toBe("job-1");
    expect(jobIdFromPath("job-1")).toBe("job-1");
  });

  it("returns null for malformed input", () => {
    expect(jobIdFromPath("")).toBeNull();
    expect(jobIdFromPath("/leading")).toBeNull();
    expect(jobIdFromPath(null)).toBeNull();
    expect(jobIdFromPath(123)).toBeNull();
  });
});
