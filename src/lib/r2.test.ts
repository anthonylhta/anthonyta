import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseListXml,
  r2Enabled,
  r2Origin,
  r2PresignGet,
  r2PresignPut,
  readKey,
  writeKey,
} from "./r2";

// The signed transport hands a Request to global fetch — stub it and inspect.
const mockFetch = vi.fn<(req: Request) => Promise<Response>>();

const stubR2Env = () => {
  vi.stubEnv("R2_ACCOUNT_ID", "acct123");
  vi.stubEnv("R2_ACCESS_KEY_ID", "AKIDEXAMPLE");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET", "hub");
};

const NO_SUCH_KEY =
  '<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>…</Message></Error>';
const NO_SUCH_BUCKET =
  '<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>…</Message></Error>';

beforeEach(() => {
  vi.clearAllMocks();
  stubR2Env();
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("r2Enabled / r2Origin", () => {
  it("requires all four env vars", () => {
    expect(r2Enabled()).toBe(true);
    for (const name of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
    ]) {
      stubR2Env();
      vi.stubEnv(name, "");
      expect(r2Enabled()).toBe(false);
    }
  });

  it("derives the endpoint origin from the account id, null when off", () => {
    expect(r2Origin()).toBe("https://acct123.r2.cloudflarestorage.com");
    vi.stubEnv("R2_ACCOUNT_ID", "");
    expect(r2Origin()).toBeNull();
  });
});

describe("parseListXml", () => {
  it("parses keys, sizes, and timestamps out of Contents blocks", () => {
    const page = parseListXml(
      `<ListBucketResult>
        <IsTruncated>false</IsTruncated>
        <Contents><Key>inbox/e-abc.bin</Key><LastModified>2026-07-09T00:00:00.000Z</LastModified><ETag>"x"</ETag><Size>2048</Size></Contents>
        <Contents><Key>inbox/e-def.bin</Key><LastModified>2026-07-10T00:00:00.000Z</LastModified><ETag>"y"</ETag><Size>17</Size></Contents>
      </ListBucketResult>`,
    );
    expect(page.objects).toEqual([
      {
        key: "inbox/e-abc.bin",
        size: 2048,
        lastModified: "2026-07-09T00:00:00.000Z",
      },
      {
        key: "inbox/e-def.bin",
        size: 17,
        lastModified: "2026-07-10T00:00:00.000Z",
      },
    ]);
    expect(page.next).toBeUndefined();
  });

  it("returns the continuation token only when truncated", () => {
    const truncated = parseListXml(
      `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok==1</NextContinuationToken>
       <Contents><Key>a</Key><Size>1</Size></Contents></ListBucketResult>`,
    );
    expect(truncated.next).toBe("tok==1");
    // A token alongside IsTruncated=false is never followed.
    const done = parseListXml(
      `<ListBucketResult><IsTruncated>false</IsTruncated><NextContinuationToken>tok</NextContinuationToken></ListBucketResult>`,
    );
    expect(done.next).toBeUndefined();
  });

  it("decodes XML entities and tolerates missing fields", () => {
    const page = parseListXml(
      `<ListBucketResult><Contents><Key>a&amp;b</Key></Contents></ListBucketResult>`,
    );
    expect(page.objects).toEqual([{ key: "a&b", size: 0, lastModified: "" }]);
  });

  it("is empty for an empty listing", () => {
    expect(
      parseListXml(
        `<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`,
      ),
    ).toEqual({ objects: [] });
  });
});

describe("presigned URLs", () => {
  it("query-signs a GET with the requested expiry, binding only host", async () => {
    const url = new URL(await r2PresignGet("inbox/e-abc.bin", 300));
    expect(url.origin).toBe("https://acct123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/hub/inbox/e-abc.bin");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(
      /^AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/,
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // Presigning never talks to the network.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("signs PUT and GET differently (the method is part of the signature)", async () => {
    const get = new URL(await r2PresignGet("meta/fin", 300));
    const put = new URL(await r2PresignPut("meta/fin", 300));
    expect(put.searchParams.get("X-Amz-Signature")).not.toBe(
      get.searchParams.get("X-Amz-Signature"),
    );
  });
});

describe("readKey", () => {
  it("is error when the store is off — without touching the network", async () => {
    vi.stubEnv("R2_BUCKET", "");
    expect(await readKey("meta/fin")).toEqual({ state: "error" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is ok with the bytes on a 200, via a signed request to the object path", async () => {
    mockFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    expect(await readKey("meta/fin")).toEqual({
      state: "ok",
      value: new Uint8Array([1, 2, 3]),
    });
    const req = mockFetch.mock.calls[0][0];
    expect(req.url).toBe(
      "https://acct123.r2.cloudflarestorage.com/hub/meta/fin",
    );
    expect(req.method).toBe("GET");
    expect(req.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
  });

  it("is absent ONLY for a NoSuchKey 404", async () => {
    mockFetch.mockImplementation(
      async () => new Response(NO_SUCH_KEY, { status: 404 }),
    );
    expect(await readKey("meta/fin")).toEqual({ state: "absent" });
  });

  it("is error for a 404 that is not NoSuchKey (a missing bucket is misconfig, not absence)", async () => {
    mockFetch.mockImplementation(
      async () => new Response(NO_SUCH_BUCKET, { status: 404 }),
    );
    expect(await readKey("meta/fin")).toEqual({ state: "error" });
  });

  it("is error on a non-200 and on a transport throw", async () => {
    mockFetch.mockImplementation(
      async () => new Response("nope", { status: 403 }),
    );
    expect(await readKey("meta/fin")).toEqual({ state: "error" });
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    expect(await readKey("meta/fin")).toEqual({ state: "error" });
  });
});

describe("writeKey", () => {
  it("is failed when the store is off — without touching the network", async () => {
    vi.stubEnv("R2_ACCESS_KEY_ID", "");
    expect(
      await writeKey("meta/fin", "x", {
        overwrite: true,
        contentType: "application/json",
      }),
    ).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("PUTs the body with the content type; no-clobber sends If-None-Match: *", async () => {
    mockFetch.mockImplementation(
      async () => new Response(null, { status: 200 }),
    );
    expect(
      await writeKey("meta/keystore", '{"v":1}', {
        overwrite: false,
        contentType: "application/json",
      }),
    ).toBe("ok");
    const req = mockFetch.mock.calls[0][0];
    expect(req.method).toBe("PUT");
    expect(req.url).toBe(
      "https://acct123.r2.cloudflarestorage.com/hub/meta/keystore",
    );
    expect(req.headers.get("content-type")).toBe("application/json");
    expect(req.headers.get("if-none-match")).toBe("*");
    expect(await req.text()).toBe('{"v":1}');
  });

  it("omits the condition when overwriting", async () => {
    mockFetch.mockImplementation(
      async () => new Response(null, { status: 200 }),
    );
    expect(
      await writeKey("meta/snap/index.json", "[]", {
        overwrite: true,
        contentType: "application/json",
      }),
    ).toBe("ok");
    expect(mockFetch.mock.calls[0][0].headers.get("if-none-match")).toBeNull();
  });

  it("maps a 412 on a no-clobber write to conflict", async () => {
    mockFetch.mockImplementation(
      async () => new Response(null, { status: 412 }),
    );
    expect(
      await writeKey("meta/keystore", "x", {
        overwrite: false,
        contentType: "application/json",
      }),
    ).toBe("conflict");
  });

  it("re-checks existence on any other no-clobber refusal: exists → conflict, absent → failed", async () => {
    // PUT attempts fail 500 (retried); the follow-up existence GET answers 200.
    mockFetch.mockImplementation(async (req) =>
      req.method === "PUT"
        ? new Response("boom", { status: 500 })
        : new Response("present", { status: 200 }),
    );
    expect(
      await writeKey("meta/keystore", "x", {
        overwrite: false,
        contentType: "application/json",
      }),
    ).toBe("conflict");

    mockFetch.mockImplementation(async (req) =>
      req.method === "PUT"
        ? new Response("boom", { status: 500 })
        : new Response(NO_SUCH_KEY, { status: 404 }),
    );
    expect(
      await writeKey("meta/keystore", "x", {
        overwrite: false,
        contentType: "application/json",
      }),
    ).toBe("failed");
  });

  it("is failed on a plain-overwrite error and on a transport throw", async () => {
    mockFetch.mockImplementation(
      async () => new Response("boom", { status: 500 }),
    );
    expect(
      await writeKey("meta/snap/index.json", "[]", {
        overwrite: true,
        contentType: "application/json",
      }),
    ).toBe("failed");
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    expect(
      await writeKey("meta/snap/index.json", "[]", {
        overwrite: true,
        contentType: "application/json",
      }),
    ).toBe("failed");
  });
});
