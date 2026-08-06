import { invariant } from "./errors.mjs";
import { inflateSync } from "node:zlib";
import sharp from "sharp";

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

function boundedDimensions(width, height) {
  invariant(
    Number.isSafeInteger(width) &&
      Number.isSafeInteger(height) &&
      width >= 1 &&
      height >= 1 &&
      width <= MAXIMUM_EVIDENCE_WIDTH &&
      height <= MAXIMUM_EVIDENCE_HEIGHT &&
      width * height <= MAXIMUM_EVIDENCE_PIXELS,
    "invalid_input",
    "Evidence image dimensions are invalid or too large.",
    { status: 400 }
  );
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
  let channels = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawImageEnd = false;
  let imageDataEnded = false;
  const imageData = [];
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
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) ===
        bytes.readUInt32BE(offset + 8 + length),
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
      invariant(
        !sawHeader && offset === 8 && length === 13,
        "invalid_input",
        "Evidence PNG structure is invalid.",
        { status: 400 }
      );
      sawHeader = true;
      width = bigEndian32(bytes, offset + 8);
      height = bigEndian32(bytes, offset + 12);
      const bitDepth = bytes[offset + 16];
      const colorType = bytes[offset + 17];
      invariant(
        bitDepth === 8 &&
          [0, 2, 4, 6].includes(colorType) &&
          bytes[offset + 18] === 0 &&
          bytes[offset + 19] === 0 &&
          bytes[offset + 20] === 0,
        "invalid_input",
        "Evidence PNG structure is invalid.",
        { status: 400 }
      );
      channels = new Map([[0, 1], [2, 3], [4, 2], [6, 4]]).get(colorType);
      boundedDimensions(width, height);
    } else if (type === "IDAT") {
      invariant(
        sawHeader && !sawImageEnd && !imageDataEnded && length > 0,
        "invalid_input",
        "Evidence PNG structure is invalid.",
        { status: 400 }
      );
      sawImageData = true;
      imageData.push(bytes.subarray(offset + 8, offset + 8 + length));
    } else if (type === "IEND") {
      invariant(
        sawHeader && sawImageData && !sawImageEnd && length === 0 &&
          end === bytes.length,
        "invalid_input",
        "Evidence PNG structure is invalid.",
        { status: 400 }
      );
      sawImageEnd = true;
    } else {
      invariant(
        sawHeader && !sawImageEnd && type.charCodeAt(0) >= 0x61,
        "invalid_input",
        "Evidence PNG structure is invalid.",
        { status: 400 }
      );
      if (sawImageData) imageDataEnded = true;
    }
    offset = end;
    if (type === "IEND") break;
  }
  invariant(
    sawHeader && sawImageData && sawImageEnd && offset === bytes.length,
    "invalid_input",
    "Evidence PNG structure is invalid.",
    { status: 400 }
  );
  const rowBytes = width * channels;
  const expectedLength = height * (rowBytes + 1);
  let pixels;
  try {
    pixels = inflateSync(Buffer.concat(imageData), {
      maxOutputLength: expectedLength
    });
  } catch {
    invariant(
      false,
      "invalid_input",
      "Evidence PNG structure is invalid.",
      { status: 400 }
    );
  }
  invariant(
    pixels.length === expectedLength,
    "invalid_input",
    "Evidence PNG structure is invalid.",
    { status: 400 }
  );
  for (let row = 0; row < height; row += 1) {
    invariant(
      pixels[row * (rowBytes + 1)] <= 4,
      "invalid_input",
      "Evidence PNG structure is invalid.",
      { status: 400 }
    );
  }
  return { width, height };
}

function jpegDimensions(bytes) {
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawQuantizationTable = false;
  let sawHuffmanTable = false;
  let sawStartOfFrame = false;
  let sawStartOfScan = false;
  let scanByteCount = 0;
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  while (offset < bytes.length) {
    invariant(
      offset + 1 < bytes.length && bytes[offset] === 0xff,
      "invalid_input",
      "Evidence JPEG structure is invalid.",
      { status: 400 }
    );
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    invariant(
      offset < bytes.length && bytes[offset] !== 0x00,
      "invalid_input",
      "Evidence JPEG structure is invalid.",
      { status: 400 }
    );
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      invariant(
        sawStartOfScan && scanByteCount > 0 && offset === bytes.length,
        "invalid_input",
        "Evidence JPEG structure is invalid.",
        { status: 400 }
      );
      break;
    }
    invariant(
      marker !== 0xd8,
      "invalid_input",
      "Evidence JPEG structure is invalid.",
      { status: 400 }
    );
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
    invariant(
      marker !== 0xfe,
      "invalid_input",
      "Evidence images must not contain embedded metadata.",
      { status: 400 }
    );
    if (marker === 0xdb) sawQuantizationTable = true;
    if (marker === 0xc4) sawHuffmanTable = true;
    if (startOfFrame.has(marker)) {
      invariant(
        !sawStartOfFrame && length >= 8,
        "invalid_input",
        "Evidence JPEG dimensions are invalid.",
        { status: 400 }
      );
      sawStartOfFrame = true;
      height = bytes[offset + 3] * 0x100 + bytes[offset + 4];
      width = bytes[offset + 5] * 0x100 + bytes[offset + 6];
    }
    offset += length;
    if (marker === 0xda) {
      sawStartOfScan = true;
      const scanStart = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const markerStart = offset;
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        invariant(
          offset < bytes.length,
          "invalid_input",
          "Evidence JPEG structure is invalid.",
          { status: 400 }
        );
        const scanMarker = bytes[offset];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          offset += 1;
          continue;
        }
        scanByteCount += markerStart - scanStart;
        offset = markerStart;
        break;
      }
    }
  }
  invariant(
    offset === bytes.length && sawQuantizationTable && sawHuffmanTable &&
      sawStartOfFrame && sawStartOfScan && scanByteCount > 0,
    "invalid_input",
    "Evidence JPEG structure is invalid.",
    { status: 400 }
  );
  return { width, height };
}

function webpDimensions(bytes) {
  invariant(
    bytes.length >= 20 && bytes.readUInt32LE(4) + 8 === bytes.length,
    "invalid_input",
    "Evidence WebP structure is invalid.",
    { status: 400 }
  );
  let offset = 12;
  let width = 0;
  let height = 0;
  let extendedWidth = 0;
  let extendedHeight = 0;
  let sawImage = false;
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
    invariant(
      !["ANIM", "ANMF"].includes(type),
      "invalid_input",
      "Animated WebP evidence is not accepted.",
      { status: 400 }
    );
    if (type === "VP8X") {
      invariant(
        length === 10 && extendedWidth === 0 && !sawImage,
        "invalid_input",
        "Evidence WebP structure is invalid.",
        { status: 400 }
      );
      extendedWidth = littleEndian24(bytes, payload + 4) + 1;
      extendedHeight = littleEndian24(bytes, payload + 7) + 1;
    } else if (
      type === "VP8 " && length >= 10 &&
      bytes[payload + 3] === 0x9d &&
      bytes[payload + 4] === 0x01 &&
      bytes[payload + 5] === 0x2a
    ) {
      const frameTag = littleEndian24(bytes, payload);
      const firstPartitionLength = frameTag >>> 5;
      invariant(
        !sawImage && (frameTag & 1) === 0 &&
          firstPartitionLength > 0 && 10 + firstPartitionLength <= length,
        "invalid_input",
        "Evidence WebP structure is invalid.",
        { status: 400 }
      );
      sawImage = true;
      width = (bytes[payload + 6] + bytes[payload + 7] * 0x100) & 0x3fff;
      height = (bytes[payload + 8] + bytes[payload + 9] * 0x100) & 0x3fff;
    } else if (type === "VP8L" && length >= 6 && bytes[payload] === 0x2f) {
      invariant(
        !sawImage && (bytes[payload + 4] & 0xe0) === 0,
        "invalid_input",
        "Evidence WebP structure is invalid.",
        { status: 400 }
      );
      sawImage = true;
      width = 1 + bytes[payload + 1] +
        ((bytes[payload + 2] & 0x3f) << 8);
      height = 1 + (bytes[payload + 2] >> 6) +
        (bytes[payload + 3] << 2) +
        ((bytes[payload + 4] & 0x0f) << 10);
    }
    offset = end + (length % 2);
  }
  invariant(
    offset === bytes.length && sawImage &&
      (extendedWidth === 0 ||
        (extendedWidth === width && extendedHeight === height)),
    "invalid_input",
    "Evidence WebP structure is invalid.",
    { status: 400 }
  );
  return { width, height };
}

async function decodedDimensions(bytes, selectedMediaType) {
  const structureMessage = selectedMediaType === "image/png"
    ? "Evidence PNG structure is invalid."
    : selectedMediaType === "image/jpeg"
      ? "Evidence JPEG structure is invalid."
      : "Evidence WebP structure is invalid.";
  let decoded;
  try {
    decoded = await sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAXIMUM_EVIDENCE_PIXELS,
      pages: 1,
      sequentialRead: true,
      unlimited: false
    })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    invariant(false, "invalid_input", structureMessage, { status: 400 });
  }
  const { data, info } = decoded;
  invariant(
    Number.isSafeInteger(info.width) &&
      Number.isSafeInteger(info.height) &&
      Number.isSafeInteger(info.channels) &&
      info.channels >= 1 &&
      info.channels <= 4 &&
      data.byteLength === info.width * info.height * info.channels,
    "invalid_input",
    structureMessage,
    { status: 400 }
  );
  return Object.freeze({ height: info.height, width: info.width });
}

async function validateImageBytes(bytes, selectedMediaType) {
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
  boundedDimensions(dimensions.width, dimensions.height);
  const decoded = await decodedDimensions(bytes, selectedMediaType);
  invariant(
    decoded.width === dimensions.width && decoded.height === dimensions.height,
    "invalid_input",
    "Evidence image dimensions do not match its decoded pixels.",
    { status: 400 }
  );
  return Object.freeze({
    height: decoded.height,
    width: decoded.width
  });
}

export async function validateServiceImageEvidence({
  bytesBase64,
  mediaType: value
}) {
  const selectedMediaType = mediaType(value);
  const bytes = strictBase64(bytesBase64);
  const dimensions = await validateImageBytes(bytes, selectedMediaType);
  return Object.freeze({
    bytes,
    height: dimensions.height,
    mediaType: selectedMediaType,
    width: dimensions.width
  });
}
