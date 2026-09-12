export type ImportedSchedule = {
  weekday: number;
  startsAt: string;
  endsAt: string;
  courseName: string;
  room: string;
};

type Block = { x: number; y: number; width: number; height: number; area: number };
type Progress = (message: string) => void;

const DAY_COUNT = 5;

function toTime(totalMinutes: number) {
  const minutes = Math.max(0, Math.min(23 * 60 + 55, Math.round(totalMinutes / 5) * 5));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function isCourseColor(red: number, green: number, blue: number) {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  return maximum - minimum > 42 && maximum > 110 && minimum < 235;
}

function isGridLine(red: number, green: number, blue: number) {
  return Math.max(red, green, blue) - Math.min(red, green, blue) < 12 && red > 205 && red < 250;
}

function groupNearby(values: number[]) {
  const groups: number[][] = [];
  for (const value of values) {
    const previous = groups.at(-1);
    if (previous && value - previous.at(-1)! <= 2) previous.push(value);
    else groups.push([value]);
  }
  return groups.map((group) => Math.round(group.reduce((sum, value) => sum + value, 0) / group.length));
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function findBlocks(image: ImageData) {
  const { width, height, data } = image;
  const total = width * height;
  const mask = new Uint8Array(total);
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);

  for (let point = 0; point < total; point += 1) {
    const pixel = point * 4;
    if (isCourseColor(data[pixel], data[pixel + 1], data[pixel + 2])) mask[point] = 1;
  }

  const blocks: Block[] = [];
  const minArea = Math.max(900, total * 0.0008);
  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    seen[start] = 1;
    let left = start % width;
    let right = left;
    let top = Math.floor(start / width);
    let bottom = top;

    while (head < tail) {
      const point = queue[head++];
      const x = point % width;
      const y = Math.floor(point / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);

      const neighbors = [point - 1, point + 1, point - width, point + width];
      for (const neighbor of neighbors) {
        if (
          neighbor < 0 ||
          neighbor >= total ||
          (neighbor === point - 1 && x === 0) ||
          (neighbor === point + 1 && x === width - 1) ||
          !mask[neighbor] ||
          seen[neighbor]
        ) continue;
        seen[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }

    const blockWidth = right - left + 1;
    const blockHeight = bottom - top + 1;
    if (tail >= minArea && blockWidth >= width * 0.06 && blockHeight >= height * 0.025) {
      blocks.push({ x: left, y: top, width: blockWidth, height: blockHeight, area: tail });
    }
  }

  return blocks;
}

function findTimeGrid(image: ImageData, gridLeft: number) {
  const { width, height, data } = image;
  const candidates: number[] = [];

  for (let y = 0; y < height; y += 1) {
    let linePixels = 0;
    let sampled = 0;
    for (let x = Math.round(gridLeft); x < width; x += 2) {
      const pixel = (y * width + x) * 4;
      if (isGridLine(data[pixel], data[pixel + 1], data[pixel + 2])) linePixels += 1;
      sampled += 1;
    }
    if (linePixels / Math.max(sampled, 1) > 0.43) candidates.push(y);
  }

  const lines = groupNearby(candidates);
  const gaps = lines.slice(1).map((line, index) => line - lines[index]);
  const likelyGaps = gaps.filter((gap) => gap > height * 0.035 && gap < height * 0.18);
  const hourHeight = median(likelyGaps) || height / 12;
  return { top: lines[0] ?? height * 0.025, hourHeight };
}

function prepareTextCanvas(source: HTMLCanvasElement, block: Block) {
  const scale = 2;
  const padding = Math.max(3, Math.round(Math.min(block.width, block.height) * 0.025));
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, (block.width - padding * 2) * scale);
  crop.height = Math.max(1, (block.height - padding * 2) * scale);
  const context = crop.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("이미지를 분석할 수 없어요.");
  context.imageSmoothingEnabled = false;
  context.drawImage(
    source,
    block.x + padding,
    block.y + padding,
    block.width - padding * 2,
    block.height - padding * 2,
    0,
    0,
    crop.width,
    crop.height,
  );

  const pixels = context.getImageData(0, 0, crop.width, crop.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const minimum = Math.min(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]);
    const value = minimum > 185 ? 0 : 255;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return crop;
}

function readCourseText(text: string) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const roomIndex = lines.findIndex((line) => /\d{1,3}(?:\s*-\s*\d{1,3}){1,3}/.test(line));
  const roomMatch = roomIndex >= 0 ? lines[roomIndex].match(/\d{1,3}(?:\s*-\s*\d{1,3}){1,3}/)?.[0] : undefined;
  const courseLines = (roomIndex >= 0 ? lines.slice(0, roomIndex) : lines)
    .filter((line) => !/(무선|랜|제공|wifi)/i.test(line));

  return {
    courseName: courseLines.join(" ").replace(/\s+/g, " ").trim() || "과목명을 확인해 주세요",
    room: roomMatch?.replace(/\s/g, "") ?? "",
  };
}

function firstHourFromText(text: string) {
  const hours = [...text.matchAll(/(?:^|\s)([0-9]{1,2})(?=\s|$)/g)].map((match) => Number(match[1]));
  const first = hours.find((hour) => hour >= 1 && hour <= 12);
  if (!first) return 9;
  // Everytime exports use a 12-hour label. A crop beginning at 1–7 is treated
  // as the afternoon range; users can still correct every detected row before saving.
  return first < 8 ? first + 12 : first;
}

export async function importEverytimeImage(file: File, onProgress: Progress): Promise<ImportedSchedule[]> {
  if (!file.type.startsWith("image/")) throw new Error("PNG 또는 JPG 시간표 이미지를 선택해 주세요.");

  onProgress("이미지의 수업 블록을 찾는 중…");
  const imageUrl = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("이미지를 열지 못했어요."));
    element.src = imageUrl;
  });

  try {
    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 1400 / longestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("이미지를 분석할 수 없어요.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const blocks = findBlocks(imageData);
    if (!blocks.length) throw new Error("에브리타임 시간표의 색상 수업 블록을 찾지 못했어요.");

    onProgress("한국어 텍스트를 읽는 중…");
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("kor+eng", 1, {
      logger: (event) => {
        if (event.status === "recognizing text") onProgress(`텍스트 인식 중… ${Math.round(event.progress * 100)}%`);
      },
    });

    try {
      const gridLeft = canvas.width * 0.048;
      const grid = findTimeGrid(imageData, gridLeft);
      const gutter = document.createElement("canvas");
      gutter.width = Math.max(1, Math.round(gridLeft));
      gutter.height = canvas.height;
      const gutterContext = gutter.getContext("2d");
      if (!gutterContext) throw new Error("시간 눈금을 읽지 못했어요.");
      gutterContext.drawImage(canvas, 0, 0, gutter.width, gutter.height, 0, 0, gutter.width, gutter.height);
      const gutterResult = await worker.recognize(gutter);
      const firstHour = firstHourFromText(gutterResult.data.text);
      const columnWidth = (canvas.width - gridLeft) / DAY_COUNT;
      const schedules: ImportedSchedule[] = [];

      for (const [index, block] of blocks.entries()) {
        onProgress(`수업 ${index + 1}/${blocks.length} 읽는 중…`);
        const result = await worker.recognize(prepareTextCanvas(canvas, block));
        const { courseName, room } = readCourseText(result.data.text);
        const weekday = Math.max(1, Math.min(DAY_COUNT, Math.floor((block.x + block.width / 2 - gridLeft) / columnWidth) + 1));
        const startsAt = toTime(firstHour * 60 + ((block.y - grid.top) / grid.hourHeight) * 60);
        const endsAt = toTime(firstHour * 60 + ((block.y + block.height - grid.top) / grid.hourHeight) * 60);
        if (startsAt < endsAt) schedules.push({ weekday, startsAt, endsAt, courseName, room });
      }

      if (!schedules.length) throw new Error("수업 시간을 계산하지 못했어요. 이미지가 시간표 전체를 포함하는지 확인해 주세요.");
      return schedules.sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));
    } finally {
      await worker.terminate();
    }
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
