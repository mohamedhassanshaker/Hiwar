import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { env } from "./env";

/**
 * Object storage over the S3 API (stack specification 4.2 and 7.3).
 *
 * Rook Ceph RGW in Test and Live, a development object store on a laptop; the application
 * only ever speaks S3, so the two are the same to it. Path-style addressing, because
 * neither endpoint serves virtual-host buckets.
 *
 * A file is never streamed through the console: the browser gets a presigned URL and goes
 * to the store directly, so a large artifact never occupies a Node process.
 */

/** The buckets of specification 7.3, so no caller spells one by hand. */
export const buckets = {
  rawDocuments: "raw-docs",
  files: "files",
  artifacts: "artifacts",
  attachments: "attachments",
  skills: "skills",
  memory: "memory",
  runPayloads: "run-payloads",
  branding: "branding",
} as const;

let client: S3Client | null = null;

/** Whether object storage is configured at all. */
export function objectStoreConfigured(): boolean {
  const configured = env();
  return Boolean(configured.S3_ENDPOINT && configured.S3_ACCESS_KEY && configured.S3_SECRET_KEY);
}

/** The process's S3 client, built on first use. Throws when the object store is not configured. */
export function objects(): S3Client {
  if (client) return client;
  const configured = env();
  if (!objectStoreConfigured()) throw new Error("S3_ENDPOINT and its credentials are not set");
  client = new S3Client({
    endpoint: configured.S3_ENDPOINT,
    region: configured.S3_REGION,
    forcePathStyle: configured.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: configured.S3_ACCESS_KEY as string,
      secretAccessKey: configured.S3_SECRET_KEY as string,
    },
  });
  return client;
}

/** Store one object and return the reference the domain row keeps. */
export async function putObject(
  bucket: string,
  key: string,
  body: Uint8Array | string,
  contentType: string,
): Promise<string> {
  await objects().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return `${bucket}/${key}`;
}

/** A reference apart into the bucket and key `putObject` joined, for anything that has to
 * reach the object store with the two apart again rather than as the one string it stored. */
export function splitReference(reference: string): { bucket: string; key: string } {
  const [bucket, ...rest] = reference.split("/");
  return { bucket, key: rest.join("/") };
}

/**
 * The bytes of one object, or `null` when the store has no such key.
 *
 * The console serves a file through itself rather than redirecting to the store: the store
 * is inside the cluster with no route of its own, and a check the browser can skip is not a
 * check. The reference is `bucket/key`, as `putObject` returned it.
 */
export async function getObject(
  reference: string,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; size: number | null } | null> {
  const { bucket, key } = splitReference(reference);
  try {
    const answer = await objects().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!answer.Body) return null;
    return {
      body: answer.Body.transformToWebStream(),
      contentType: answer.ContentType ?? "application/octet-stream",
      size: answer.ContentLength ?? null,
    };
  } catch (problem) {
    if ((problem as { name?: string }).name === "NoSuchKey") return null;
    throw problem;
  }
}

/**
 * Remove one object. Deleting a file or an artifact removes it from the project; the audit
 * records of the deletion stay (specification 7.2.7).
 */
export async function deleteObject(reference: string): Promise<void> {
  const { bucket, key } = splitReference(reference);
  await objects().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
