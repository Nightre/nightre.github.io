const TRANSPARENT_INDEX = 0;
const MAX_OPAQUE_COLORS = 255;
const GIF_PALETTE_SIZE = 256;
const GIF_LZW_CODE_SIZE = 8;

export class GifEncoder {
  constructor(width, height, delay) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error("GIF dimensions must be positive integers");
    }
    if (width > 65535 || height > 65535) {
      throw new Error("GIF dimensions exceed the format limit");
    }

    this.width = width;
    this.height = height;
    this.delay = Math.max(2, Math.min(65535, Math.round(delay)));
    this.bytes = beginGif(width, height);
    this.frameCount = 0;
    this.finished = false;
  }

  addFrame(rgba) {
    if (this.finished) throw new Error("Cannot add a frame after finishing the GIF");
    if (rgba.length !== this.width * this.height * 4) {
      throw new Error("GIF frame dimensions do not match the encoder");
    }

    appendGifFrame(
      this.bytes,
      this.width,
      this.height,
      quantizeFrame(rgba),
      this.delay,
    );
    this.frameCount += 1;
  }

  finish() {
    if (this.finished) throw new Error("GIF has already been finished");
    if (!this.frameCount) throw new Error("GIF requires at least one frame");
    this.bytes.push(0x3b);
    this.finished = true;
    return new Uint8Array(this.bytes);
  }
}

function quantizeFrame(data) {
  const histogram = new Map();
  for (let source = 0; source < data.length; source += 4) {
    if (data[source + 3] < 128) continue;
    const key = ((data[source] >> 3) << 10)
      | ((data[source + 1] >> 3) << 5)
      | (data[source + 2] >> 3);
    const color = histogram.get(key);
    if (color) {
      color.count += 1;
      color.red += data[source];
      color.green += data[source + 1];
      color.blue += data[source + 2];
    } else {
      histogram.set(key, {
        key,
        count: 1,
        red: data[source],
        green: data[source + 1],
        blue: data[source + 2],
      });
    }
  }

  const colors = [...histogram.values()].map((color) => ({
    ...color,
    red: color.red / color.count,
    green: color.green / color.count,
    blue: color.blue / color.count,
  }));
  const boxes = colors.length ? [makeColorBox(colors)] : [];
  while (boxes.length < MAX_OPAQUE_COLORS) {
    const splitIndex = findBoxToSplit(boxes);
    if (splitIndex < 0) break;
    boxes.splice(splitIndex, 1, ...splitColorBox(boxes[splitIndex]));
  }

  const palette = [255, 255, 255];
  const colorIndices = new Map();
  boxes.forEach((box, boxIndex) => {
    let count = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (const color of box.colors) {
      count += color.count;
      red += color.red * color.count;
      green += color.green * color.count;
      blue += color.blue * color.count;
      colorIndices.set(color.key, boxIndex + 1);
    }
    palette.push(
      Math.round(red / count),
      Math.round(green / count),
      Math.round(blue / count),
    );
  });
  while (palette.length < GIF_PALETTE_SIZE * 3) palette.push(0, 0, 0);

  const indices = new Uint8Array(data.length / 4);
  for (let source = 0, target = 0; source < data.length; source += 4, target += 1) {
    if (data[source + 3] < 128) continue;
    const key = ((data[source] >> 3) << 10)
      | ((data[source + 1] >> 3) << 5)
      | (data[source + 2] >> 3);
    indices[target] = colorIndices.get(key) ?? TRANSPARENT_INDEX;
  }
  return { indices, palette };
}

function findBoxToSplit(boxes) {
  let splitIndex = -1;
  let splitScore = -1;
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    if (box.colors.length < 2) continue;
    const score = box.range * Math.sqrt(box.count);
    if (score > splitScore) {
      splitIndex = index;
      splitScore = score;
    }
  }
  return splitIndex;
}

function makeColorBox(colors) {
  const minimum = [255, 255, 255];
  const maximum = [0, 0, 0];
  let count = 0;
  for (const color of colors) {
    count += color.count;
    const values = [color.red, color.green, color.blue];
    for (let channel = 0; channel < 3; channel += 1) {
      minimum[channel] = Math.min(minimum[channel], values[channel]);
      maximum[channel] = Math.max(maximum[channel], values[channel]);
    }
  }
  const ranges = maximum.map((value, index) => value - minimum[index]);
  const channel = ranges.indexOf(Math.max(...ranges));
  return { colors, count, channel, range: ranges[channel] };
}

function splitColorBox(box) {
  const channels = ["red", "green", "blue"];
  const sorted = [...box.colors].sort((left, right) => (
    left[channels[box.channel]] - right[channels[box.channel]]
  ));
  const midpoint = box.count / 2;
  let runningCount = 0;
  let splitAt = 1;
  for (; splitAt < sorted.length; splitAt += 1) {
    runningCount += sorted[splitAt - 1].count;
    if (runningCount >= midpoint) break;
  }
  splitAt = Math.min(splitAt, sorted.length - 1);
  return [
    makeColorBox(sorted.slice(0, splitAt)),
    makeColorBox(sorted.slice(splitAt)),
  ];
}

function beginGif(width, height) {
  const bytes = [];
  writeString(bytes, "GIF89a");
  writeShort(bytes, width);
  writeShort(bytes, height);
  bytes.push(0xf0, TRANSPARENT_INDEX, 0);
  bytes.push(0, 0, 0, 0, 0, 0);
  bytes.push(0x21, 0xff, 0x0b);
  writeString(bytes, "NETSCAPE2.0");
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);
  return bytes;
}

function appendGifFrame(bytes, width, height, frame, delay) {
  bytes.push(0x21, 0xf9, 0x04, 0x09);
  writeShort(bytes, delay);
  bytes.push(TRANSPARENT_INDEX, 0);
  bytes.push(0x2c);
  writeShort(bytes, 0);
  writeShort(bytes, 0);
  writeShort(bytes, width);
  writeShort(bytes, height);
  bytes.push(0x87);
  bytes.push(...frame.palette);
  writeLzwImageData(bytes, frame.indices);
}

function writeLzwImageData(bytes, indices) {
  bytes.push(GIF_LZW_CODE_SIZE);
  const compressed = lzwEncode(indices);
  for (let offset = 0; offset < compressed.length; offset += 255) {
    const block = compressed.subarray(offset, offset + 255);
    bytes.push(block.length, ...block);
  }
  bytes.push(0);
}

function lzwEncode(indices) {
  const clearCode = 1 << GIF_LZW_CODE_SIZE;
  const endCode = clearCode + 1;
  let nextCode = endCode + 1;
  let codeSize = GIF_LZW_CODE_SIZE + 1;
  let bitBuffer = 0;
  let bitCount = 0;
  const output = [];
  let dictionary = createLzwDictionary(clearCode);

  function writeCode(code) {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  }

  writeCode(clearCode);
  let prefix = String(indices[0] ?? TRANSPARENT_INDEX);
  for (let index = 1; index < indices.length; index += 1) {
    const value = indices[index];
    const combined = `${prefix},${value}`;
    if (dictionary.has(combined)) {
      prefix = combined;
      continue;
    }

    writeCode(dictionary.get(prefix));
    if (nextCode < 4096) {
      dictionary.set(combined, nextCode);
      nextCode += 1;
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      writeCode(clearCode);
      dictionary = createLzwDictionary(clearCode);
      nextCode = endCode + 1;
      codeSize = GIF_LZW_CODE_SIZE + 1;
    }
    prefix = String(value);
  }

  writeCode(dictionary.get(prefix));
  writeCode(endCode);
  if (bitCount > 0) output.push(bitBuffer & 0xff);
  return new Uint8Array(output);
}

function createLzwDictionary(colorCount) {
  const dictionary = new Map();
  for (let index = 0; index < colorCount; index += 1) {
    dictionary.set(String(index), index);
  }
  return dictionary;
}

function writeString(bytes, value) {
  for (let index = 0; index < value.length; index += 1) {
    bytes.push(value.charCodeAt(index));
  }
}

function writeShort(bytes, value) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}
