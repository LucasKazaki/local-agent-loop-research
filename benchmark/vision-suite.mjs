import { deflateSync } from 'node:zlib';
import { parseJsonObject } from './json-contracts.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function createCanvas(width, height, background = [250, 250, 247]) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = background[0];
    pixels[offset + 1] = background[1];
    pixels[offset + 2] = background[2];
  }
  function set(x, y, color) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 3;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
  }
  function rect(x, y, w, h, color) {
    for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) set(px, py, color);
  }
  function circle(cx, cy, radius, color) {
    for (let y = -radius; y <= radius; y += 1) {
      const half = Math.floor(Math.sqrt(radius * radius - y * y));
      for (let x = -half; x <= half; x += 1) set(cx + x, cy + y, color);
    }
  }
  function triangle(cx, top, size, color) {
    for (let row = 0; row < size; row += 1) {
      const half = Math.floor((row / size) * size * 0.58);
      for (let x = -half; x <= half; x += 1) set(cx + x, top + row, color);
    }
  }
  return { width, height, pixels, rect, circle, triangle };
}

export function makeDiagnosticImage() {
  const canvas = createCanvas(512, 512);
  const ink = [35, 40, 48];
  const red = [218, 45, 52];
  const green = [34, 150, 83];
  const blue = [37, 99, 205];
  const purple = [126, 65, 180];
  const gridLeft = 61;
  const gridTop = 35;
  const cellWidth = 130;
  const cellHeight = 112;
  for (let line = 0; line <= 3; line += 1) {
    canvas.rect(gridLeft + line * cellWidth - 2, gridTop, 4, cellHeight * 3, ink);
    canvas.rect(gridLeft, gridTop + line * cellHeight - 2, cellWidth * 3, 4, ink);
  }
  // One-indexed positions: red circle R1C3, green triangle R2C2, blue square R3C1.
  canvas.circle(gridLeft + 2 * cellWidth + 65, gridTop + 56, 33, red);
  canvas.triangle(gridLeft + cellWidth + 65, gridTop + cellHeight + 23, 65, green);
  canvas.rect(gridLeft + 37, gridTop + 2 * cellHeight + 28, 56, 56, blue);
  // Five separate purple bars form an independent counting target.
  for (let index = 0; index < 5; index += 1) canvas.rect(86 + index * 72, 421, 42, 58, purple);

  const stride = canvas.width * 3 + 1;
  const raw = Buffer.alloc(stride * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    raw[y * stride] = 0;
    canvas.pixels.copy(raw, y * stride + 1, y * canvas.width * 3, (y + 1) * canvas.width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND'),
  ]);
  return { png, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
}

function checks(...conditions) {
  return conditions.filter(Boolean).length / conditions.length;
}

export const visionTasks = [
  {
    id: 'vision_grid_localization', category: 'vision_spatial', maxTokens: 180,
    prompt: 'The image has a 3 by 3 grid above a separate row of bars. Rows and columns are numbered from 1 at the top-left. Return one JSON object and no markdown: {"redCircle":{"row":number,"column":number},"greenTriangle":{"row":number,"column":number},"blueSquare":{"row":number,"column":number}}.',
    score(text) {
      const v = parseJsonObject(text);
      return checks(v?.redCircle?.row === 1 && v?.redCircle?.column === 3, v?.greenTriangle?.row === 2 && v?.greenTriangle?.column === 2, v?.blueSquare?.row === 3 && v?.blueSquare?.column === 1);
    },
  },
  {
    id: 'vision_counting', category: 'vision_counting', maxTokens: 80,
    prompt: 'Ignore the grid. Count the separate purple bars along the bottom of the image. Return exactly one integer and nothing else.',
    score(text) { return String(text || '').trim() === '5' ? 1 : 0; },
  },
  {
    id: 'vision_negative_grounding', category: 'vision_grounding', maxTokens: 100,
    prompt: 'Does the image contain an orange star? Return exactly PRESENT or ABSENT and nothing else.',
    score(text) { return String(text || '').trim() === 'ABSENT' ? 1 : 0; },
  },
];
