import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

export class S3ObjectStore {
  constructor({ client, bucket, prefix = "fabric" }) {
    if (!client || !bucket)
      throw new Error("S3 client and bucket are required");
    this.client = client;
    this.bucket = bucket;
    this.prefix = prefix.replace(/^\/|\/$/g, "");
  }

  key(workspaceId, objectId) {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(workspaceId) ||
      !/^[a-zA-Z0-9_.-]+$/.test(objectId)
    )
      throw new Error("Invalid object key segment");
    return `${this.prefix}/${workspaceId}/${objectId}`;
  }

  async put({
    workspaceId,
    objectId,
    body,
    contentType,
    metadata = {},
    contentLength,
    signal,
  }) {
    const Key = this.key(workspaceId, objectId);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key,
        Body: body,
        ContentType: contentType,
        ContentLength: contentLength,
        Metadata: { ...metadata, workspace: workspaceId },
        ServerSideEncryption: process.env.S3_SERVER_SIDE_ENCRYPTION || "AES256",
      }),
      { abortSignal: signal },
    );
    return Key;
  }

  async get({ workspaceId, objectId, signal }) {
    return this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key(workspaceId, objectId),
      }),
      { abortSignal: signal },
    );
  }

  async delete({ workspaceId, objectId, signal }) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.key(workspaceId, objectId),
      }),
      { abortSignal: signal },
    );
  }
}
