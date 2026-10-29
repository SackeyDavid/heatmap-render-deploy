import { assertSafeStorageKey, pointerDocument } from "../../../domain/storage-key.ts";
import { createHash } from "node:crypto";
import { awsSignedFetch, type AwsCredentials } from "../../net/aws-sigv4-fetch.ts";
import type { PointerTarget, PublishedRef, RemoteStorage } from "../../../ports/index.ts";

export interface S3StorageConfig {
  region: string;
  bucket: string;
  credentials: AwsCredentials;
  /** When set, PublishedRef.url is `${publicBaseUrl}/${key}` (CDN or public bucket prefix). */
  publicBaseUrl?: string;
  /** Optional custom endpoint (MinIO, LocalStack). Default: https://s3.{region}.amazonaws.com */
  endpoint?: string;
  /** How long one request to S3 may take before it is abandoned. Default 30 s, so a stalled endpoint cannot hang a job. */
  timeoutMs?: number;
}

/** What S3 should say each stored file is. Everything here is text; only the script is JavaScript. */
export function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  const type = ext === "js" ? "application/javascript" : ext === "json" ? "application/json" : ext === "md" ? "text/markdown" : ext === "html" ? "text/html" : "text/plain";
  return `${type}; charset=utf-8`;
}


function objectUrl(cfg: S3StorageConfig, key: string): URL {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  if (cfg.endpoint) {
    const base = cfg.endpoint.replace(/\/+$/, "");
    return new URL(`${base}/${cfg.bucket}/${encodedKey}`);
  }
  return new URL(`https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${encodedKey}`);
}

/** RemoteStorage backed by S3 (or S3-compatible). Chosen by `bindings.remoteStorage: s3` in the manifest. */
export class S3RemoteStorage implements RemoteStorage {
  constructor(private readonly cfg: S3StorageConfig) {}

  private publicUrl(key: string): string {
    if (this.cfg.publicBaseUrl) return `${this.cfg.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
    return objectUrl(this.cfg, key).href;
  }

  async put(key: string, body: string): Promise<PublishedRef> {
    assertSafeStorageKey(key);
    const url = objectUrl(this.cfg, key);
    const res = await awsSignedFetch({
      region: this.cfg.region,
      service: "s3",
      credentials: this.cfg.credentials,
      method: "PUT",
      url,
      body,
      headers: { "content-type": contentTypeFor(key) },
      timeoutMs: this.cfg.timeoutMs,
    });
    if (!res.ok) throw new Error(`S3 put failed for key ${key} (HTTP ${res.status})`);
    return { key, url: this.publicUrl(key), sha256: createHash("sha256").update(body).digest("hex") };
  }

  async get(key: string): Promise<string | null> {
    assertSafeStorageKey(key);
    const url = objectUrl(this.cfg, key);
    const res = await awsSignedFetch({
      region: this.cfg.region,
      service: "s3",
      credentials: this.cfg.credentials,
      method: "GET",
      url,
      timeoutMs: this.cfg.timeoutMs,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 get failed for key ${key} (HTTP ${res.status})`);
    return res.text();
  }

  async pin(pointerKey: string, target: PointerTarget): Promise<void> {
    await this.put(pointerKey, pointerDocument(await this.get(pointerKey), target));
  }
}
