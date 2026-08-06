import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS,
  validateServiceImageEvidence
} from "../service-image-evidence.mjs";

const MAXIMUM_EVIDENCE_BYTES = 700 * 1024;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

function pngChunk(type, payload = Buffer.alloc(0)) {
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4, 4, "ascii");
  payload.copy(chunk, 8);
  return chunk;
}

function png(width = 1, height = 1, extraChunks = []) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    ...extraChunks,
    pngChunk("IEND")
  ]);
}

function jpeg(width = 1, height = 1) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x07, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff
  ]);
}

function webp(width = 1, height = 1) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, 4, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, 4, "ascii");
  bytes.write("VP8X", 12, 4, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

function webpMetadata(type) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, 4, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, 4, "ascii");
  bytes.write(type, 12, 4, "ascii");
  bytes.writeUInt32LE(0, 16);
  return bytes;
}

function validate(bytes, mediaType) {
  return validateServiceImageEvidence({
    bytesBase64: bytes.toString("base64"),
    mediaType
  });
}

function rejects(bytesBase64, mediaType, message) {
  assert.throws(
    () => validateServiceImageEvidence({ bytesBase64, mediaType }),
    (error) => {
      assert.equal(error.code, "invalid_input");
      assert.equal(error.status, 400);
      assert.equal(error.message, message);
      return true;
    }
  );
}

test("accepts bounded JPEG, PNG, and WebP evidence without changing bytes", () => {
  const cases = [
    ["image/jpeg", jpeg(), "jpg"],
    ["image/png", png(), "png"],
    ["image/webp", webp(), "webp"]
  ];
  for (const [mediaType, bytes, extension] of cases) {
    const result = validate(bytes, mediaType);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.mediaType, mediaType);
    assert.deepEqual(result.bytes, bytes);
    assert.equal(
      SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS[mediaType],
      extension
    );
  }
  assert.equal(Object.isFrozen(SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS), true);
});

test("preserves the exact media-type and base64 validation errors", () => {
  rejects(
    "%%%%",
    "image/gif",
    "Only JPEG, PNG, or WebP screenshot evidence is accepted."
  );
  rejects("%%%%", "image/png", "Evidence image data is invalid.");
  rejects(
    "AB==",
    "image/png",
    "Evidence image data is invalid or too large."
  );

  const maximum = Buffer.concat([
    png(),
    Buffer.alloc(MAXIMUM_EVIDENCE_BYTES - png().length)
  ]);
  assert.equal(validate(maximum, "image/png").bytes.length, maximum.length);
  rejects(
    Buffer.concat([maximum, Buffer.from([0])]).toString("base64"),
    "image/png",
    "Evidence image data is invalid or too large."
  );
});

test("requires bytes to match the selected image type", () => {
  rejects(
    png().toString("base64"),
    "image/jpeg",
    "Evidence bytes do not match the selected image type."
  );
});

test("preserves format-specific structure errors", () => {
  const malformedPng = png();
  malformedPng.writeUInt32BE(12, 8);
  rejects(
    malformedPng.toString("base64"),
    "image/png",
    "Evidence PNG structure is invalid."
  );
  rejects(
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07])
      .toString("base64"),
    "image/jpeg",
    "Evidence JPEG structure is invalid."
  );
  rejects(
    Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBP", "binary")
      .toString("base64"),
    "image/webp",
    "Evidence WebP structure is invalid."
  );
  rejects(
    Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x06, 0x08, 0x00, 0x01, 0x00
    ]).toString("base64"),
    "image/jpeg",
    "Evidence JPEG dimensions are invalid."
  );
});

test("rejects every metadata-bearing chunk rejected by assessment evidence", () => {
  for (const type of ["eXIf", "iTXt", "tEXt", "zTXt"]) {
    rejects(
      png(1, 1, [pngChunk(type)]).toString("base64"),
      "image/png",
      "Evidence images must not contain embedded metadata."
    );
  }
  rejects(
    Buffer.from([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x02,
      0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x01, 0x00, 0x01
    ]).toString("base64"),
    "image/jpeg",
    "Evidence images must not contain embedded EXIF metadata."
  );
  for (const type of ["EXIF", "XMP "]) {
    rejects(
      webpMetadata(type).toString("base64"),
      "image/webp",
      "Evidence images must not contain embedded metadata."
    );
  }
});

test("preserves the assessment evidence dimension bounds", () => {
  validate(png(2048, 5000), "image/png");
  for (const bytes of [png(0, 1), png(2049, 1), png(1, 5001)]) {
    rejects(
      bytes.toString("base64"),
      "image/png",
      "Evidence image dimensions are invalid or too large."
    );
  }
});
