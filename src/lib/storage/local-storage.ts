import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const assetRoot = process.env.ASSET_STORAGE_ROOT || path.join(process.cwd(), ".local-assets");

export type StoredAsset = {
  storageRef: string;
  absolutePath: string;
  checksum: string;
};

async function ensureRoot() {
  await mkdir(assetRoot, { recursive: true });
}

export async function saveContentAsAsset(
  projectId: string,
  extension: string,
  content: string,
  encoding: BufferEncoding = "utf8"
): Promise<StoredAsset> {
  await ensureRoot();

  const bucketDir = path.join(assetRoot, projectId);
  await mkdir(bucketDir, { recursive: true });

  const hash = crypto.createHash("sha1").update(content).digest("hex").slice(0, 16);
  const fileName = `${Date.now()}-${hash}.${extension}`;
  const absolutePath = path.join(bucketDir, fileName);

  await writeFile(absolutePath, content, { encoding });

  return {
    storageRef: path.join(projectId, fileName),
    absolutePath,
    checksum: hash,
  };
}

export function getAssetAbsolutePath(storageRef: string): string {
  return path.join(assetRoot, storageRef);
}

export async function readAssetContent(storageRef: string): Promise<Buffer> {
  return readFile(getAssetAbsolutePath(storageRef));
}
