import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { S3ObjectStore } from "../src/infrastructure/object-store.mjs";
// This suite never uses application/production buckets. Explicit test opt-in and
// a unique bucket ensure cleanup can touch only objects created by this run.
test(
  "real S3 encrypted round-trip, namespace separation, cancellation and deletion",
  { timeout: 45000 },
  async () => {
    assert.equal(
      process.env.NODE_ENV,
      "test",
      "Storage integration requires NODE_ENV=test",
    );
    const endpoint = process.env.FABRIC_TEST_S3_ENDPOINT;
    assert.ok(
      endpoint && endpoint === process.env.S3_ENDPOINT,
      "Explicit disposable S3 endpoint opt-in is required",
    );
    const url = new URL(endpoint);
    assert.ok(
      ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password,
      "Unsupported S3 test endpoint",
    );
    assert.ok(
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
      "Disposable S3 credentials are required",
    );
    const bucket = "fabric-test-" + randomUUID(),
      prefix = "integration-" + randomUUID(),
      created = [];
    const client = new S3Client({
      endpoint,
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    });
    const store = new S3ObjectStore({ client, bucket, prefix }),
      wsA = "workspace-a",
      wsB = "workspace-b",
      objectId = randomUUID();
    let bucketCreated = false;
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }), {
        abortSignal: AbortSignal.timeout(15000),
      });
      bucketCreated = true;
      const body = Buffer.from("genuine-object-storage\n\u2603\0binary");
      created.push([wsA, objectId]);
      const key = await store.put({
        workspaceId: wsA,
        objectId,
        body,
        contentLength: body.length,
        contentType: "application/octet-stream",
        metadata: {
          workspace: "untrusted-override",
          source: "storage-integration",
        },
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(key, `${prefix}/${wsA}/${objectId}`);
      const head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
      assert.equal(
        head.ServerSideEncryption,
        process.env.S3_SERVER_SIDE_ENCRYPTION || "AES256",
      );
      assert.equal(head.ContentLength, body.length);
      assert.equal(head.Metadata.workspace, wsA);
      const result = await store.get({
        workspaceId: wsA,
        objectId,
        signal: AbortSignal.timeout(10000),
      });
      assert.deepEqual(
        Buffer.from(await result.Body.transformToByteArray()),
        body,
      );
      await assert.rejects(
        store.get({
          workspaceId: wsB,
          objectId,
          signal: AbortSignal.timeout(10000),
        }),
        (error) => error.$metadata?.httpStatusCode === 404,
      );
      created.push([wsB, objectId]);
      await store.put({
        workspaceId: wsB,
        objectId,
        body: Buffer.from("separate"),
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(
        await (
          await store.get({
            workspaceId: wsB,
            objectId,
            signal: AbortSignal.timeout(10000),
          })
        ).Body.transformToString(),
        "separate",
      );
      for (const invalid of ["../outside", "a/b", "a\\b", "a%2Fb", ""])
        assert.throws(
          () => store.key(invalid, objectId),
          /Invalid object key segment/,
        );
      const aborted = new AbortController();
      aborted.abort();
      await assert.rejects(
        store.get({ workspaceId: wsA, objectId, signal: aborted.signal }),
        (error) => error.name === "AbortError",
      );
      await store.delete({
        workspaceId: wsA,
        objectId,
        signal: AbortSignal.timeout(10000),
      });
      await assert.rejects(
        store.get({
          workspaceId: wsA,
          objectId,
          signal: AbortSignal.timeout(10000),
        }),
        (error) => error.$metadata?.httpStatusCode === 404,
      );
      const listed = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix + "/" }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
      assert.deepEqual(
        (listed.Contents || []).map((x) => x.Key),
        [store.key(wsB, objectId)],
      );
    } finally {
      try {
        if (bucketCreated) {
          for (const [workspaceId, id] of created)
            await store.delete({
              workspaceId,
              objectId: id,
              signal: AbortSignal.timeout(10000),
            });
          await client.send(new DeleteBucketCommand({ Bucket: bucket }), {
            abortSignal: AbortSignal.timeout(10000),
          });
        }
      } finally {
        client.destroy();
      }
    }
  },
);
