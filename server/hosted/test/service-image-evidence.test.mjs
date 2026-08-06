import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS,
  validateServiceImageEvidence
} from "../service-image-evidence.mjs";

const MAXIMUM_EVIDENCE_BYTES = 700 * 1024;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);
const JPEG_WITH_METADATA = readFileSync(
  new URL("../../../assets/work-daarx-current.jpg", import.meta.url)
);
const PNG_EVIDENCE = readFileSync(
  new URL("../../../assets/work-demo-bright-spark.png", import.meta.url)
);
const WEBP_EVIDENCE = readFileSync(
  new URL("../../../assets/work-demo-bright-spark-720.webp", import.meta.url)
);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload = Buffer.alloc(0)) {
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4, 4, "ascii");
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + payload.length)), 8 + payload.length);
  return chunk;
}

function png(width = 1, height = 1, extraChunks = [], shade = 0) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const rows = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const start = row * (width + 1);
    rows[start] = 0;
    rows.fill(shade, start + 1, start + 1 + width);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    ...extraChunks,
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND")
  ]);
}

function stripJpegApp1(bytes) {
  const parts = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    const markerStart = offset;
    assert.equal(bytes[offset], 0xff);
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) {
      parts.push(bytes.subarray(markerStart));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(bytes.subarray(markerStart, offset));
      continue;
    }
    const length = bytes.readUInt16BE(offset);
    const end = offset + length;
    assert.ok(length >= 2 && end <= bytes.length);
    if (marker !== 0xe1) parts.push(bytes.subarray(markerStart, end));
    offset = end;
  }
  return Buffer.concat(parts);
}

const JPEG_EVIDENCE = stripJpegApp1(JPEG_WITH_METADATA);

function webpMetadata(type) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, 4, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, 4, "ascii");
  bytes.write(type, 12, 4, "ascii");
  bytes.writeUInt32LE(0, 16);
  return bytes;
}

async function validate(bytes, mediaType) {
  return validateServiceImageEvidence({
    bytesBase64: bytes.toString("base64"),
    mediaType
  });
}

async function rejects(bytesBase64, mediaType, message) {
  await assert.rejects(
    validateServiceImageEvidence({ bytesBase64, mediaType }),
    (error) => {
      assert.equal(error.code, "invalid_input");
      assert.equal(error.status, 400);
      assert.equal(error.message, message);
      return true;
    }
  );
}

test("accepts bounded JPEG, PNG, and WebP evidence with exact dimensions", async () => {
  const cases = [
    ["image/jpeg", JPEG_EVIDENCE, "jpg", 1440, 900],
    ["image/png", PNG_EVIDENCE, "png", 1440, 1000],
    ["image/webp", WEBP_EVIDENCE, "webp", 720, 500]
  ];
  for (const [mediaType, bytes, extension, width, height] of cases) {
    const result = await validate(bytes, mediaType);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.mediaType, mediaType);
    assert.deepEqual(result.bytes, bytes);
    assert.equal(result.width, width);
    assert.equal(result.height, height);
    assert.equal(
      SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS[mediaType],
      extension
    );
  }
  assert.equal(Object.isFrozen(SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS), true);
});

test("preserves the exact media-type and base64 validation errors", async () => {
  await rejects(
    "%%%%",
    "image/gif",
    "Only JPEG, PNG, or WebP screenshot evidence is accepted."
  );
  await rejects("%%%%", "image/png", "Evidence image data is invalid.");
  await rejects(
    "AB==",
    "image/png",
    "Evidence image data is invalid or too large."
  );

  await rejects(
    Buffer.alloc(MAXIMUM_EVIDENCE_BYTES + 1).toString("base64"),
    "image/png",
    "Evidence image data is invalid or too large."
  );
});

test("requires bytes to match the selected image type", async () => {
  await rejects(
    png().toString("base64"),
    "image/jpeg",
    "Evidence bytes do not match the selected image type."
  );
});

test("preserves format-specific structure errors", async () => {
  const malformedPng = png();
  malformedPng.writeUInt32BE(12, 8);
  await rejects(
    malformedPng.toString("base64"),
    "image/png",
    "Evidence PNG structure is invalid."
  );
  await rejects(
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07])
      .toString("base64"),
    "image/jpeg",
    "Evidence JPEG structure is invalid."
  );
  await rejects(
    Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBP", "binary")
      .toString("base64"),
    "image/webp",
    "Evidence WebP structure is invalid."
  );
  await rejects(
    Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x06, 0x08, 0x00, 0x01, 0x00
    ]).toString("base64"),
    "image/jpeg",
    "Evidence JPEG dimensions are invalid."
  );
});

test("rejects header-only and truncated image structures", async () => {
  const headerOnlyWebp = Buffer.alloc(30);
  headerOnlyWebp.write("RIFF", 0, 4, "ascii");
  headerOnlyWebp.writeUInt32LE(22, 4);
  headerOnlyWebp.write("WEBP", 8, 4, "ascii");
  headerOnlyWebp.write("VP8X", 12, 4, "ascii");
  headerOnlyWebp.writeUInt32LE(10, 16);
  headerOnlyWebp.writeUIntLE(719, 24, 3);
  headerOnlyWebp.writeUIntLE(499, 27, 3);
  for (const [bytes, mediaType, message] of [
    [png().subarray(0, -12), "image/png", "Evidence PNG structure is invalid."],
    [JPEG_EVIDENCE.subarray(0, -2), "image/jpeg", "Evidence JPEG structure is invalid."],
    [headerOnlyWebp, "image/webp", "Evidence WebP structure is invalid."],
    [WEBP_EVIDENCE.subarray(0, -1), "image/webp", "Evidence WebP structure is invalid."]
  ]) await rejects(bytes.toString("base64"), mediaType, message);
});

test("rejects structurally plausible JPEG and WebP data that cannot decode", async () => {
  const fakeJpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xdb, 0x00, 0x02,
    0xff, 0xc4, 0x00, 0x02,
    0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x01, 0x00, 0x01, 0x00,
    0xff, 0xda, 0x00, 0x02,
    0x11,
    0xff, 0xd9
  ]);
  const fakeWebp = Buffer.alloc(32);
  fakeWebp.write("RIFF", 0, 4, "ascii");
  fakeWebp.writeUInt32LE(24, 4);
  fakeWebp.write("WEBP", 8, 4, "ascii");
  fakeWebp.write("VP8 ", 12, 4, "ascii");
  fakeWebp.writeUInt32LE(11, 16);
  fakeWebp[20] = 0x20;
  fakeWebp[23] = 0x9d;
  fakeWebp[24] = 0x01;
  fakeWebp[25] = 0x2a;
  fakeWebp[26] = 0x01;
  fakeWebp[28] = 0x01;
  fakeWebp[30] = 0x11;
  await rejects(
    fakeJpeg.toString("base64"),
    "image/jpeg",
    "Evidence JPEG structure is invalid."
  );
  await rejects(
    fakeWebp.toString("base64"),
    "image/webp",
    "Evidence WebP structure is invalid."
  );
});

test("rejects every metadata-bearing chunk rejected by assessment evidence", async () => {
  for (const type of ["eXIf", "iTXt", "tEXt", "zTXt"]) {
    await rejects(
      png(1, 1, [pngChunk(type)]).toString("base64"),
      "image/png",
      "Evidence images must not contain embedded metadata."
    );
  }
  await rejects(
    JPEG_WITH_METADATA.toString("base64"),
    "image/jpeg",
    "Evidence images must not contain embedded EXIF metadata."
  );
  for (const type of ["EXIF", "XMP "]) {
    await rejects(
      webpMetadata(type).toString("base64"),
      "image/webp",
      "Evidence images must not contain embedded metadata."
    );
  }
});

test("preserves the assessment evidence dimension bounds", async () => {
  await validate(png(2048, 5000), "image/png");
  for (const bytes of [png(0, 1), png(2049, 1), png(1, 5001)]) {
    await rejects(
      bytes.toString("base64"),
      "image/png",
      "Evidence image dimensions are invalid or too large."
    );
  }
});
