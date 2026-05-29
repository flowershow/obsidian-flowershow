import { describe, it, expect, vi } from "vitest";
import type { App, TFile } from "obsidian";
import Publisher from "./Publisher";
import type { IFlowershowSettings } from "./settings";
import { calculateTextSha } from "./utils";

/**
 * The load-bearing invariant in Publisher.publishBatch: the SHA submitted to
 * the server (via client.publishFiles) must hash exactly the bytes that the
 * client subsequently PUTs to R2 (via client.uploadToR2). If the two diverge
 * — for example because rewriteRootDirPaths was applied to one but not the
 * other — the server will reject the upload as a hash mismatch.
 *
 * These tests pin that invariant by running publishBatch against a stubbed
 * FlowershowClient that captures both the submitted metadata and the actual
 * upload bytes, then re-hashes the upload bytes and asserts equality.
 */

const baseSettings = (overrides: Partial<IFlowershowSettings> = {}): IFlowershowSettings => ({
  flowershowToken: "fs_pat_test",
  siteName: "test-site",
  rootDir: "",
  excludePatterns: [],
  lastSeenVersion: "",
  ...overrides,
});

interface FakeFile {
  path: string;
  extension: string;
  content: string;
}

function makeApp(files: FakeFile[]): App {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const vault = {
    cachedRead: vi.fn(async (file: TFile) => byPath.get(file.path)!.content),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    getName: () => "test-vault",
    getFiles: () =>
      files.map(
        (f) =>
          ({
            path: f.path,
            extension: f.extension,
            stat: { size: f.content.length },
          }) as TFile,
      ),
  };
  const metadataCache = { getCache: () => null };
  return { vault, metadataCache } as unknown as App;
}

interface ClientStub {
  publishCalls: { siteId: string; files: { path: string; sha: string }[] }[];
  uploadCalls: { uploadUrl: string; bytes: Uint8Array; contentType: string }[];
}

function stubClient(publisher: Publisher): ClientStub {
  const stub: ClientStub = { publishCalls: [], uploadCalls: [] };
  // biome-ignore lint/suspicious/noExplicitAny: replacing private field for testing
  (publisher as any).client = {
    getUserInfo: async () => ({ username: "tester" }),
    getSiteByName: async () => ({
      site: {
        id: "site-id",
        projectName: "test-site",
        url: "https://example.com",
        userId: "tester",
        createdAt: "",
      },
    }),
    publishFiles: async (
      siteId: string,
      files: { path: string; sha: string }[],
    ) => {
      stub.publishCalls.push({ siteId, files });
      return {
        files: files.map((f) => ({
          path: f.path,
          uploadUrl: `https://r2.example.com/${f.path}`,
          blobId: `blob-${f.path}`,
          contentType: "text/markdown",
        })),
      };
    },
    uploadToR2: async (
      uploadUrl: string,
      content: ArrayBuffer | Uint8Array,
      contentType: string,
    ) => {
      const bytes =
        content instanceof Uint8Array
          ? new Uint8Array(content)
          : new Uint8Array(content);
      stub.uploadCalls.push({ uploadUrl, bytes, contentType });
      return true;
    },
    deleteFiles: vi.fn(async () => ({ deleted: [], notFound: [] })),
  };
  return stub;
}

function makeTFile(file: FakeFile): TFile {
  return {
    path: file.path,
    extension: file.extension,
    stat: { size: file.content.length },
  } as TFile;
}

describe("Publisher.publishBatch SHA / upload invariant", () => {
  it("submits a SHA that matches the bytes uploaded to R2 (no rootDir)", async () => {
    const file: FakeFile = { path: "note.md", extension: "md", content: "Hello world" };
    const app = makeApp([file]);
    const publisher = new Publisher(app, baseSettings());
    const stub = stubClient(publisher);

    await publisher.publishBatch({ filesToPublish: [makeTFile(file)] });

    expect(stub.publishCalls).toHaveLength(1);
    expect(stub.uploadCalls).toHaveLength(1);

    const submittedSha = stub.publishCalls[0].files[0].sha;
    const uploadedSha = await calculateTextSha(
      new TextDecoder().decode(stub.uploadCalls[0].bytes),
    );
    expect(submittedSha).toBe(uploadedSha);
  });

  it("strips the rootDir prefix from the submitted path and applies the rewriter consistently", async () => {
    const file: FakeFile = {
      path: "Public/Recipes/bread.md",
      extension: "md",
      content: "See [[Public/Other/topic]] for more.",
    };
    const app = makeApp([file]);
    const publisher = new Publisher(app, baseSettings({ rootDir: "Public" }));
    const stub = stubClient(publisher);

    await publisher.publishBatch({ filesToPublish: [makeTFile(file)] });

    // Submitted path has rootDir stripped
    expect(stub.publishCalls[0].files[0].path).toBe("Recipes/bread.md");

    // Uploaded bytes have the wikilink rewritten too
    const uploadedText = new TextDecoder().decode(stub.uploadCalls[0].bytes);
    expect(uploadedText).toBe("See [[Other/topic]] for more.");

    // And the SHA still matches
    const submittedSha = stub.publishCalls[0].files[0].sha;
    const uploadedSha = await calculateTextSha(uploadedText);
    expect(submittedSha).toBe(uploadedSha);
  });

  it("publishes multiple files and matches each submitted SHA to its upload", async () => {
    const files: FakeFile[] = [
      { path: "a.md", extension: "md", content: "alpha" },
      { path: "b.md", extension: "md", content: "beta beta beta" },
      { path: "c.md", extension: "md", content: "gamma\nwith newlines\n" },
    ];
    const app = makeApp(files);
    const publisher = new Publisher(app, baseSettings());
    const stub = stubClient(publisher);

    await publisher.publishBatch({
      filesToPublish: files.map(makeTFile),
    });

    expect(stub.publishCalls[0].files).toHaveLength(3);
    expect(stub.uploadCalls).toHaveLength(3);

    for (const upload of stub.uploadCalls) {
      const matchingSubmission = stub.publishCalls[0].files.find(
        (f) => upload.uploadUrl.endsWith(f.path),
      );
      expect(matchingSubmission).toBeDefined();
      const uploadedSha = await calculateTextSha(
        new TextDecoder().decode(upload.bytes),
      );
      expect(matchingSubmission!.sha).toBe(uploadedSha);
    }
  });
});

describe("Publisher.publishBatch deletion path", () => {
  it("normalizes deletion paths through rootDir", async () => {
    const app = makeApp([]);
    const publisher = new Publisher(app, baseSettings({ rootDir: "Public" }));
    const stub = stubClient(publisher);
    let deleteCall: { siteId: string; paths: string[] } | null = null;
    // biome-ignore lint/suspicious/noExplicitAny: replacing private field for testing
    (publisher as any).client.deleteFiles = vi.fn(
      async (siteId: string, paths: string[]) => {
        deleteCall = { siteId, paths };
        return { deleted: paths, notFound: [] };
      },
    );

    await publisher.publishBatch({
      filesToDelete: ["Public/Recipes/bread.md", "Public/Other/topic.md"],
    });

    expect(deleteCall).not.toBeNull();
    expect(deleteCall!.paths).toEqual([
      "Recipes/bread.md",
      "Other/topic.md",
    ]);
    expect(stub.publishCalls).toHaveLength(0);
    expect(stub.uploadCalls).toHaveLength(0);
  });
});
