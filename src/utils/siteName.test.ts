import { describe, it, expect } from "vitest";
import {
  normalizeSiteName,
  buildSiteLookupPath,
  looksLikeUrlOrDomain,
  siteNotFoundMessage,
} from "./publisherHelpers";

const URL_HINT = "not its URL or custom domain";

describe("normalizeSiteName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeSiteName("  my-notes \t")).toBe("my-notes");
  });
});

describe("buildSiteLookupPath", () => {
  it("trims and encodes the site name", () => {
    expect(buildSiteLookupPath("alice", " my-notes ")).toBe(
      "/api/sites/alice/my-notes",
    );
    expect(buildSiteLookupPath("alice", "my site/x")).toBe(
      "/api/sites/alice/my%20site%2Fx",
    );
  });
});

describe("siteNotFoundMessage", () => {
  it("flags a custom domain", () => {
    expect(looksLikeUrlOrDomain("example.com")).toBe(true);
    const msg = siteNotFoundMessage("example.com");
    expect(msg).toContain('Site "example.com" was not found.');
    expect(msg).toContain(URL_HINT);
  });

  it("flags a site URL", () => {
    const url = "https://x.flowershow.app/@u/site";
    expect(looksLikeUrlOrDomain(url)).toBe(true);
    expect(siteNotFoundMessage(url)).toContain(URL_HINT);
  });

  it("gives a generic case-sensitive hint for a plain name", () => {
    expect(looksLikeUrlOrDomain("my-notes")).toBe(false);
    const msg = siteNotFoundMessage(" My-Notes ");
    expect(msg).toContain('Site "My-Notes" was not found.');
    expect(msg).toContain("case-sensitive");
    expect(msg).not.toContain(URL_HINT);
  });
});
