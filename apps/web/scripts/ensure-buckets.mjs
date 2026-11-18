// Creates the object-store buckets `src/lib/objects.ts` expects to already exist (`putObject`
// issues a plain `PutObjectCommand`, it does not create buckets) and enables versioning on the
// ones `infra/charts/awp/values.yaml` marks `versioned`. Used by `scripts/dev-local.sh` and by
// CI (`.github/workflows/verify.yml`) against a local MinIO; idempotent against repeated runs.
import {
  CreateBucketCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const VERSIONED = new Set(["files", "artifacts", "memory"]);

const buckets = process.argv.slice(2);
if (buckets.length === 0) throw new Error("usage: ensure-buckets.mjs <bucket>...");

const endpoint = process.env.S3_ENDPOINT;
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;
if (!endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error("S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY must be set");
}

const client = new S3Client({
  endpoint,
  region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

for (const bucket of buckets) {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`  ${bucket} created`);
  } catch (error) {
    if (error.name === "BucketAlreadyOwnedByYou" || error.name === "BucketAlreadyExists") {
      console.log(`  ${bucket} already exists`);
    } else {
      throw error;
    }
  }
  if (VERSIONED.has(bucket)) {
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: "Enabled" },
      }),
    );
  }
}
