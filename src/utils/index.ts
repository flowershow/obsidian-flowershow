// --- Hash helpers ---
function hex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

async function digest(
  algo: "SHA-1" | "SHA-256",
  data: Uint8Array,
): Promise<string> {
  const ab = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  const d = await crypto.subtle.digest(algo, ab);
  return hex(d);
}

// Build: "blob <len>\0<bytes>"
function gitBlobFramedBytes(contentBytes: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(`blob ${contentBytes.byteLength}\0`);
  const out = new Uint8Array(header.length + contentBytes.length);
  out.set(header, 0);
  out.set(contentBytes, header.length);
  return out;
}

async function gitBlobOid(contentBytes: Uint8Array, algo: GitAlgo) {
  const framed = gitBlobFramedBytes(contentBytes);
  return digest(algo, framed);
}

export async function gitBlobOidFromText(text: string, algo: GitAlgo) {
  const bytes = new TextEncoder().encode(text);
  return gitBlobOid(bytes, algo);
}

export async function gitBlobOidFromBinary(
  bytes: ArrayBuffer | Uint8Array,
  algo: GitAlgo,
) {
  const u8: Uint8Array =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
  return gitBlobOid(u8, algo);
}

export class FlowershowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowershowError";
  }
}

export function detectGitAlgoFromSha(sha?: string): GitAlgo {
  return sha?.length === 64 ? "SHA-256" : "SHA-1";
}

export function isPlainTextExtension(ext: string) {
  return ["md", "mdx", "json", "yaml", "yml", "css"].includes(ext);
}
export type GitAlgo = "SHA-1" | "SHA-256";

export function createPRNotice(
  message: string,
  prNumber: number,
  prUrl: string,
  merged: boolean,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(document.createTextNode(`${message} PR #${prNumber} `));

  const a = document.createElement("a");
  a.href = prUrl;
  a.textContent = merged ? "merged" : "created";
  a.target = "_blank";
  a.rel = "noopener noreferrer";

  frag.append(a);
  return frag;
}
