import { invariant } from "./errors.mjs";

const MAXIMUM_EVIDENCE_BYTES = 700 * 1024;
const MAXIMUM_EVIDENCE_WIDTH = 2048;
const MAXIMUM_EVIDENCE_HEIGHT = 5000;
const MAXIMUM_EVIDENCE_PIXELS =
  MAXIMUM_EVIDENCE_WIDTH * MAXIMUM_EVIDENCE_HEIGHT;

export const SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
});

function mediaType(value) {
  invariant(
    Object.hasOwn(SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS, value),
    "invalid_input",
    "Only JPEG, PNG, or WebP screenshot evidence is accepted.",
    { status: 400 }
  );
  return value;
}

function strictBase64(value) {
  invariant(
    typeof value === "string" &&
      value.length >= 4 &&
      value.length <= Math.ceil(MAXIMUM_EVIDENCE_BYTES / 3) * 4 + 4 &&
      /^[A-Za-z0-9+/]+={0,2}$/u.test(value),
    "invalid_input",
    "Evidence image data is invalid.",
    { status: 400 }
  );
  const bytes = Buffer.from(value, "base64");
  invariant(
    bytes.byteLength > 0 &&
      bytes.byteLength <= MAXIMUM_EVIDENCE_BYTES &&
      bytes.toString("base64").replace(/=+$/u, "") ===
        value.replace(/=+$/u, ""),
    "invalid_input",
    "Evidence image data is invalid or too large.",
    { status: 400 }
  );
  return bytes;
}

function bigEndian32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function littleEndian24(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x10000;
}

function pngDimensions(bytes) {
  invariant(
    bytes.length >= 33 &&
      bytes.subarray(12, 16).toString("ascii") === "IHDR" &&
      bigEndian32(bytes, 8) === 13,
    "invalid_input",
    "Evidence PNG structure is invalid.",
    { status: 400 }
  );
  let offset = 8;
  let width = 0;
  let height = 0;
  while (offset + 12 <= bytes.length) {
    const length = bigEndian32(bytes, offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    invariant(
      Number.isSafeInteger(length) && end <= bytes.length,
      "invalid_input",
      "Evidence PNG structure is invalid.",
      { status: 400 }
    );
    invariant(
      !["eXIf", "iTXt", "tEXt", "zTXt"].includes(type),
      "invalid_input",
      "Evidence images must not contain embedded metadata.",
      { status: 400 }
    );
    if (type === "IHDR") {
      width = bigEndian32(bytes, offset + 8);
      height = bigEndian32(bytes, offset + 12);
    }
    offset = end;
    if (type === "IEND") break;
  }
  return { width, height };
}

function jpegDimensions(bytes) {
  let offset = 2;
  let width = 0;
  let height = 0;
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  while (offset + 3 < bytes.length) {
    invariant(
      bytes[offset] === 0xff,
      "invalid_input",
      "Evidence JPEG structure is invalid.",
      { status: 400 }
    );
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    invariant(
      offset + 2 <= bytes.length,
      "invalid_input",
      "Evidence JPEG structure is invalid.",
      { status: 400 }
    );
    const length = bytes[offset] * 0x100 + bytes[offset + 1];
    invariant(
      length >= 2 && offset + length <= bytes.length,
      "invalid_input",
      "Evidence JPEG structure is invalid.",
      { status: 400 }
    );
    invariant(
      marker !== 0xe1,
      "invalid_input",
      "Evidence images must not contain embedded EXIF metadata.",
      { status: 400 }
    );
    if (startOfFrame.has(marker)) {
      invariant(
        length >= 7,
        "invalid_input",
        "Evidence JPEG dimensions are invalid.",
        { status: 400 }
      );
      height = bytes[offset + 3] * 0x100 + bytes[offset + 4];
      width = bytes[offset + 5] * 0x100 + bytes[offset + 6];
    }
    offset += length;
  }
  return { width, height };
}

function webpDimensions(bytes) {
  invariant(
    bytes.length >= 30 && bytes.readUInt32LE(4) + 8 <= bytes.length,
    "invalid_input",
    "Evidence WebP structure is invalid.",
    { status: 400 }
  );
  let offset = 12;
  let width = 0;
  let height = 0;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const end = payload + length;
    invariant(
      end <= bytes.length,
      "invalid_input",
      "Evidence WebP structure is invalid.",
      { status: 400 }
    );
    invariant(
      !["EXIF", "XMP "].includes(type),
      "invalid_input",
      "Evidence images must not contain embedded metadata.",
      { status: 400 }
    );
    if (type === "VP8X" && length >= 10) {
      width = littleEndian24(bytes, payload + 4) + 1;
      height = littleEndian24(bytes, payload + 7) + 1;
    } else if (
      type === "VP8 " && length >= 10 &&
      bytes[payload + 3] === 0x9d &&
      bytes[payload + 4] === 0x01 &&
      bytes[payload + 5] === 0x2a
    ) {
      width = (bytes[payload + 6] + bytes[payload + 7] * 0x100) & 0x3fff;
      height = (bytes[payload + 8] + bytes[payload + 9] * 0x100) & 0x3fff;
    } else if (type === "VP8L" && length >= 5 && bytes[payload] === 0x2f) {
      width = 1 + bytes[payload + 1] +
        ((bytes[payload + 2] & 0x3f) << 8);
      height = 1 + (bytes[payload + 2] >> 6) +
        (bytes[payload + 3] << 2) +
        ((bytes[payload + 4] & 0x0f) << 10);
    }
    offset = end + (length % 2);
  }
  return { width, height };
}

function validateImageBytes(bytes, selectedMediaType) {
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const png =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  const webp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  invariant(
    (selectedMediaType === "image/jpeg" && jpeg) ||
      (selectedMediaType === "image/png" && png) ||
      (selectedMediaType === "image/webp" && webp),
    "invalid_input",
    "Evidence bytes do not match the selected image type.",
    { status: 400 }
  );
  const dimensions = selectedMediaType === "image/png"
    ? pngDimensions(bytes)
    : selectedMediaType === "image/jpeg"
      ? jpegDimensions(bytes)
      : webpDimensions(bytes);
  invariant(
    Number.isSafeInteger(dimensions.width) &&
      Number.isSafeInteger(dimensions.height) &&
      dimensions.width >= 1 &&
      dimensions.height >= 1 &&
      dimensions.width <= MAXIMUM_EVIDENCE_WIDTH &&
      dimensions.height <= MAXIMUM_EVIDENCE_HEIGHT &&
      dimensions.width * dimensions.height <= MAXIMUM_EVIDENCE_PIXELS,
    "invalid_input",
    "Evidence image dimensions are invalid or too large.",
    { status: 400 }
  );
}

export function validateServiceImageEvidence({ bytesBase64, mediaType: value }) {
  const selectedMediaType = mediaType(value);
  const bytes = strictBase64(bytesBase64);
  validateImageBytes(bytes, selectedMediaType);
  return Object.freeze({
    bytes,
    mediaType: selectedMediaType
  });
}
