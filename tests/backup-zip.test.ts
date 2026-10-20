import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Minimal stand-in for expo-file-system's File/Directory/FileHandle, backed by Node fs.
const { root, toPath } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require("node:os") as typeof import("node:os");
  return { root: nodeFs.mkdtempSync(`${nodeOs.tmpdir()}/shelfwatch-zip-`), toPath: (uri: string) => uri.replace(/^file:\/\//, "") };
});
vi.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | Directory)[]) { this.uri = parts.map((p) => (typeof p === "string" ? p : p.uri)).join("/").replace(/\/+/g, "/").replace(/^file:\//, "file:///"); }
    create() { fs.mkdirSync(toPath(this.uri), { recursive: true }); }
  }
  class File {
    uri: string;
    constructor(...parts: (string | Directory | File)[]) { this.uri = parts.map((p) => (typeof p === "string" ? p : p.uri)).join("/").replace(/\/+/g, "/").replace(/^file:\//, "file:///"); }
    get exists() { return fs.existsSync(toPath(this.uri)); }
    get size() { return fs.statSync(toPath(this.uri)).size; }
    create() { fs.writeFileSync(toPath(this.uri), new Uint8Array()); }
    delete() { fs.rmSync(toPath(this.uri)); }
    async bytes() { return new Uint8Array(fs.readFileSync(toPath(this.uri))); }
    open() {
      const fd = fs.openSync(toPath(this.uri), "r+");
      let offset = 0;
      return {
        size: fs.fstatSync(fd).size,
        readBytes(length: number) { const buffer = Buffer.alloc(length); const read = fs.readSync(fd, buffer, 0, length, offset); offset += read; return new Uint8Array(buffer.subarray(0, read)); },
        writeBytes(bytes: Uint8Array) { fs.writeSync(fd, bytes, 0, bytes.length, offset); offset += bytes.length; },
        close() { fs.closeSync(fd); },
      };
    }
  }
  return { File, Directory, Paths: { cache: new Directory(`file://${root}`) } };
});

import { isZipFile, readZipBackup, writeZipBackup } from "../lib/backup-zip";
import { createInventoryBackup } from "../lib/inventory-backup";
import { DEFAULT_SETTINGS } from "../lib/inventory";

describe("zip backup with separate photo files", () => {
  it("round-trips data and full-size photos without a size cap", async () => {
    const photoA = path.join(root, "a.jpg");
    const photoB = path.join(root, "b.png");
    const bigBytes = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251); // larger than the old 1 MB cap
    fs.writeFileSync(photoA, bigBytes);
    fs.writeFileSync(photoB, new Uint8Array([1, 2, 3, 4]));
    const backup = createInventoryBackup({
      activeUserId: "default",
      profiles: [{ id: "default", displayName: "ร้าน", storageName: "คลัง", products: [], deletedProducts: [], settings: DEFAULT_SETTINGS, positionHistory: [] }],
      imageFiles: [
        { sourceUri: "file:///old/a.jpg", localUri: `file://${photoA}`, extension: "jpg", size: 0, path: "images/img-00001.jpg" },
        { sourceUri: "file:///old/b.png", localUri: `file://${photoB}`, extension: "png", size: 0, path: "images/img-00002.png" },
        { sourceUri: "file:///old/missing.jpg", localUri: `file://${root}/missing.jpg`, extension: "jpg", size: 0, path: "images/img-00003.jpg" },
      ],
    });

    const written = await writeZipBackup(backup);
    expect(written.writtenImages).toBe(2);
    expect(written.failedImages).toBe(1);
    expect(isZipFile(written.uri)).toBe(true);

    const restored = await readZipBackup(written.uri);
    expect(restored.profiles[0].displayName).toBe("ร้าน");
    expect(restored.skippedImageCount).toBe(1);
    expect(restored.imageFiles?.map((f) => f.sourceUri)).toEqual(["file:///old/a.jpg", "file:///old/b.png"]);
    const restoredA = restored.imageFiles?.[0].localUri ?? "";
    expect(Buffer.compare(fs.readFileSync(toPath(restoredA)), Buffer.from(bigBytes))).toBe(0);
    expect([...fs.readFileSync(toPath(restored.imageFiles?.[1].localUri ?? ""))]).toEqual([1, 2, 3, 4]);
  });

  it("recognises non-zip files", () => {
    const jsonPath = path.join(root, "old.json");
    fs.writeFileSync(jsonPath, "{}");
    expect(isZipFile(`file://${jsonPath}`)).toBe(false);
  });
});
