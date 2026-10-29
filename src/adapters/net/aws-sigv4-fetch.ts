import { createHash, createHmac } from "node:crypto";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignedFetchOptions {
  region: string;
  service: string;
  credentials: AwsCredentials;
  method: string;
  url: URL;
  headers?: Record<string, string>;
  body?: string;
  /** Abandon the request after this long. Default 30 s. */
  timeoutMs?: number;
}

/** Minimal SigV4 signing for S3 REST (PutObject and GetObject). */
export async function awsSignedFetch(opts: SignedFetchOptions): Promise<Response> {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(opts.body ?? "");
  const headers: Record<string, string> = {
    host: opts.url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(opts.credentials.sessionToken ? { "x-amz-security-token": opts.credentials.sessionToken } : {}),
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined && !headers["content-type"]) headers["content-type"] = "text/plain; charset=utf-8";

  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k.toLowerCase()}:${headers[k]!.trim()}\n`)
    .join("");
  const signedHeaderNames = Object.keys(headers)
    .sort()
    .map((k) => k.toLowerCase())
    .join(";");

  const canonicalRequest = [
    opts.method,
    canonicalUri(opts.url.pathname),
    opts.url.search ? opts.url.search.slice(1) : "",
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = getSignatureKey(opts.credentials.secretAccessKey, dateStamp, opts.region, opts.service);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${opts.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`;

  return fetch(opts.url, {
    method: opts.method,
    headers: { ...headers, authorization },
    body: opts.body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function toAmzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalUri(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
    .join("/")
    .replace(/\/+/g, "/");
}

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac("sha256", `AWS4${key}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update(service).digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}
