import { assertPoseActive, poseGeometry, promptSheetGeometry, type PoseOptions, type PoseRobotStyle } from "@/lib/canvas/pose-portrait";

async function decode(blob: Blob, signal: AbortSignal): Promise<HTMLImageElement> {
    assertPoseActive(signal);
    const url = URL.createObjectURL(blob);
    try {
        return await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            const finish = (error?: Error) => {
                clearTimeout(timer); signal.removeEventListener("abort", abort); image.onload = image.onerror = null;
                if (error) { image.src = ""; reject(error); } else resolve(image);
            };
            const abort = () => finish(new DOMException("已停止", "AbortError"));
            const timer = setTimeout(() => finish(new Error("图片解码超时")), 10000);
            signal.addEventListener("abort", abort, { once: true });
            image.onload = () => finish(image.naturalWidth && image.naturalHeight ? undefined : new Error("图片尺寸无效"));
            image.onerror = () => finish(new Error("图片无法解码")); image.src = url;
        });
    } finally { URL.revokeObjectURL(url); }
}
export async function encodePoseImage(blob: Blob, signal: AbortSignal, mimeType: "image/png" | "image/jpeg"): Promise<Blob> {
    assertPoseActive(signal);
    // A stored blob already in the requested format needs no resampling or recompression.
    if (blob.type === mimeType) return blob;
    const image = await decode(blob, signal); assertPoseActive(signal);
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("浏览器不支持 Canvas");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
    try { return await encode(canvas, signal, mimeType); }
    finally { canvas.width = canvas.height = 0; }
}
function encode(canvas: HTMLCanvasElement, signal: AbortSignal, mimeType: "image/png" | "image/jpeg") {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
        if (signal.aborted) reject(new DOMException("已停止", "AbortError"));
        else if (!blob) reject(new Error("图片导出失败")); else resolve(blob);
    }, mimeType, 0.92));
}
export async function buildPromptSheet(character: Blob, action: Blob, signal: AbortSignal): Promise<Blob> {
    // 反推接口只读一张图，所以把角色与动作并成一张交给模型；不画标签，避免把文字当内容。
    const first = await decode(character, signal); assertPoseActive(signal);
    const second = await decode(action, signal); assertPoseActive(signal);
    const g = promptSheetGeometry({ width: first.naturalWidth, height: first.naturalHeight }, { width: second.naturalWidth, height: second.naturalHeight });
    const canvas = document.createElement("canvas"); canvas.width = g.width; canvas.height = g.height;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("浏览器不支持 Canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, g.width, g.height);
    [first, second].forEach((image, i) => { const cell = g.cells[i], fit = g.fits[i]; ctx.drawImage(image, cell.x + Math.floor((cell.width - fit.width) / 2), cell.y, fit.width, fit.height); });
    assertPoseActive(signal);
    try { return await encode(canvas, signal, "image/jpeg"); }
    finally { canvas.width = canvas.height = 0; }
}
export function mangaAlpha(luma: number) {
    if (!Number.isFinite(luma) || luma >= 246) return 0;
    return Math.min(255, Math.round((255 - luma) * 1.25));
}
// 绿幕去背：只有明显偏绿且高饱和的像素才透明，黑白墨线与白色机体保持不透明。
export function chromaAlpha(r: number, g: number, b: number) {
    const greenness = g - Math.max(r, b);
    if (greenness <= 40) return 255;
    if (greenness >= 110) return 0;
    return Math.round(255 * (1 - (greenness - 40) / 70));
}
function inkOnly(image: HTMLImageElement): HTMLCanvasElement | null {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || typeof ctx.getImageData !== "function") { canvas.width = canvas.height = 0; return null; }
    try {
        ctx.drawImage(image, 0, 0);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height), data = frame.data;
        for (let i = 0; i < data.length; i += 4) {
            const alpha = chromaAlpha(data[i], data[i + 1], data[i + 2]);
            if (alpha === 255) continue;
            data[i + 3] = Math.min(data[i + 3], alpha);
            // 去溢色：绿色边缘向中性灰收敛，避免白线发绿。
            const edge = Math.min(data[i + 1], Math.max(data[i], data[i + 2]) + 24);
            data[i + 1] = edge;
        }
        ctx.putImageData(frame, 0, 0);
        return canvas;
    } catch { canvas.width = canvas.height = 0; return null; }
}
// 抠像后的图四周全是透明边：按 alpha 包围盒裁紧，贴到海报上才能占满高度而不是缩成一小块。
function trimAlpha(source: HTMLCanvasElement, data: Uint8ClampedArray): HTMLCanvasElement | null {
    let minX = source.width, minY = source.height, maxX = -1, maxY = -1;
    for (let y = 0; y < source.height; y += 1) {
        for (let x = 0; x < source.width; x += 1) {
            if (data[(y * source.width + x) * 4 + 3] <= 8) continue;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    }
    if (maxX < minX || maxY < minY) return null;
    const pad = Math.max(4, Math.round(Math.min(source.width, source.height) * 0.02));
    const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
    const width = Math.min(source.width - x, maxX - minX + 1 + pad * 2);
    const height = Math.min(source.height - y, maxY - minY + 1 + pad * 2);
    if (width >= source.width && height >= source.height) return null;
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d"); if (!ctx) { canvas.width = canvas.height = 0; return null; }
    ctx.drawImage(source, x, y, width, height, 0, 0, width, height);
    return canvas;
}
export const POSE_FRAME_URL = "/frames/openeuler-summit-2026.webp";
// 透明图看起来太空：抠像后在透明层上补一圈放射速度线，线条不会因为绿幕被一起抠掉。
// 动漫画风的图是绿幕拍出来的：抠成透明 PNG（并补速度线）后再存，后续拼图/导出的节点图才能直接叠背景。
export async function transparentPose(blob: Blob, style: PoseRobotStyle, signal: AbortSignal): Promise<Blob> {
    const image = await decode(blob, signal); assertPoseActive(signal);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("浏览器不支持 Canvas");
    try {
        ctx.drawImage(image, 0, 0);
        if (typeof ctx.getImageData === "function") {
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height), data = frame.data;
            for (let i = 0; i < data.length; i += 4) {
                const alpha = chromaAlpha(data[i], data[i + 1], data[i + 2]);
                if (alpha === 255) continue;
                data[i + 3] = Math.min(data[i + 3], alpha);
                data[i + 1] = Math.min(data[i + 1], Math.max(data[i], data[i + 2]) + 24);
            }
            ctx.putImageData(frame, 0, 0);
            assertPoseActive(signal);
            const cropped = trimAlpha(canvas, data);
            if (cropped) { canvas.width = canvas.height = 0; return await encode(cropped, signal, "image/png"); }
        }
        assertPoseActive(signal);
        return await encode(canvas, signal, "image/png");
    } finally { canvas.width = canvas.height = 0; }
}
type FrameLoader = () => Promise<Blob>;
let posterFrame: Blob | null = null;
// 海报是别人出的成品图：只 fetch 一次做背景，绝不重绘或改动原图内容。
export async function loadPoseFrame(): Promise<Blob> {
    if (posterFrame) return posterFrame;
    const response = await fetch(POSE_FRAME_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`海报背景加载失败（HTTP ${response.status}）`);
    posterFrame = await response.blob();
    return posterFrame;
}
function renderGrid(first: HTMLImageElement, second: HTMLImageElement, options: PoseOptions): HTMLCanvasElement {
    const g = poseGeometry({ width: first.naturalWidth, height: first.naturalHeight }, { width: second.naturalWidth, height: second.naturalHeight }, options);
    const canvas = document.createElement("canvas"); canvas.width = g.width; canvas.height = g.height;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("浏览器不支持 Canvas");
    ctx.imageSmoothingQuality = "high";
    // 所有动漫画风都要求纯绿背景：这里再抠一次保证透明；只有实拍写实才保留原始背景。
    const manga = options.style !== "realistic";
    // 透明画布：不铺纸色/白底，让背景真的透明（帧模式会先铺海报）。
    if (!manga) { ctx.fillStyle = "white"; ctx.fillRect(0, 0, g.width, g.height); }
    // 分格内部也不再铺白：图本身已是透明 PNG，铺白会把“透明”又盖回去。
    const inks = manga ? [inkOnly(first), inkOnly(second)] : [null, null];
    // 绿幕抠像后的透明 PNG 才能真正叠到任意背景上。
    [first, second].forEach((image, i) => { const r = g.images[i]; ctx.drawImage(inks[i] ?? image, r.x, r.y, r.width, r.height); });
    inks.forEach(layer => { if (layer) { layer.width = layer.height = 0; } });
    // 简约卡通分格：白底 + 每格黑色粗边框，像漫画分镜。
    if (options.style === "toon" && options.frame !== "openeuler" && typeof ctx.strokeRect === "function") {
        const line = Math.max(2, Math.round(Math.min(g.width, g.height) * 0.0022));
        ctx.strokeStyle = "#1A1A1A"; ctx.lineWidth = line;
        (g.frames ?? g.images).forEach(r => ctx.strokeRect(r.x, r.y, r.width, r.height));
    }
    if (g.separator && options.separator === "black") { const r = g.separator; ctx.fillStyle = "black"; ctx.fillRect(r.x, r.y, r.width, r.height); }
    ctx.fillStyle = "black"; ctx.font = `${g.fontSize}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    g.labels.forEach(r => ctx.fillText(r.text, r.x + r.width / 2, r.y + r.height / 2, r.width));
    return canvas;
}
export async function composePosePortrait(person: Blob, action: Blob, options: PoseOptions, signal: AbortSignal, mimeType: "image/png" | "image/jpeg" = "image/png", loadFrame: FrameLoader = loadPoseFrame): Promise<Blob> {
    const first = await decode(person, signal); assertPoseActive(signal);
    const second = await decode(action, signal); assertPoseActive(signal);
    // 海报模式不再先拼二宫格：左右两张各自对称摆放，不受对方宽高和气泡影响。
    if (options.frame === "openeuler") return mountPairOnFrame(first, second, options, signal, mimeType, loadFrame);
    const grid = renderGrid(first, second, options);
    try { assertPoseActive(signal); return await encode(grid, signal, mimeType); }
    finally { grid.width = grid.height = 0; }
}
// 单张模式也可以装到海报上：同一套白卡纸与安全区，只是内容的宽高比不同。
export async function composeSinglePose(blob: Blob, options: PoseOptions, signal: AbortSignal, mimeType: "image/png" | "image/jpeg" = "image/png", loadFrame: FrameLoader = loadPoseFrame): Promise<Blob> {
    const picture = await decode(blob, signal); assertPoseActive(signal);
    if (options.frame !== "openeuler") return encodePoseImage(blob, signal, mimeType);
    return mountOnFrame(picture, picture.naturalWidth, picture.naturalHeight, options, signal, mimeType, loadFrame);
}
// 主体的重心与“身体”上下界：气泡只画在头顶一角，按 alpha 累积 2%~99% 取范围就不会被它撑高。
function alphaShape(image: HTMLImageElement): { cx: number; top: number; bottom: number } | null {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || typeof ctx.getImageData !== "function") { canvas.width = canvas.height = 0; return null; }
    try {
        ctx.drawImage(image, 0, 0);
        const width = canvas.width, height = canvas.height;
        const frame = ctx.getImageData(0, 0, width, height), data = frame.data;
        // 只在最大连通块上量身体：气泡、星星等悬空元素单独成块，不能把包围盒撑高、把身高算短。
        const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
        const gw = Math.ceil(width / step), gh = Math.ceil(height / step);
        const mask = new Uint8Array(gw * gh), label = new Int32Array(gw * gh);
        for (let gy = 0; gy < gh; gy += 1) {
            for (let gx = 0; gx < gw; gx += 1) {
                const x = Math.min(width - 1, gx * step + (step >> 1)), y = Math.min(height - 1, gy * step + (step >> 1));
                mask[gy * gw + gx] = data[(y * width + x) * 4 + 3] > 16 ? 1 : 0;
            }
        }
        const stack: number[] = [];
        let best = 0, bestSize = 0, id = 0;
        for (let at0 = 0; at0 < mask.length; at0 += 1) {
            if (!mask[at0] || label[at0]) continue;
            id += 1; let size = 0;
            label[at0] = id; stack.push(at0);
            while (stack.length) {
                const at = stack.pop() as number;
                size += 1;
                const px = at % gw, py = (at / gw) | 0;
                if (px > 0 && mask[at - 1] && !label[at - 1]) { label[at - 1] = id; stack.push(at - 1); }
                if (px + 1 < gw && mask[at + 1] && !label[at + 1]) { label[at + 1] = id; stack.push(at + 1); }
                if (py > 0 && mask[at - gw] && !label[at - gw]) { label[at - gw] = id; stack.push(at - gw); }
                if (py + 1 < gh && mask[at + gw] && !label[at + gw]) { label[at + gw] = id; stack.push(at + gw); }
            }
            if (size > bestSize) { bestSize = size; best = id; }
        }
        let weight = 0, xsum = 0, top = height - 1, bottom = 0;
        for (let y = 0; y < height; y += 1) {
            const gy = Math.min(gh - 1, (y / step) | 0);
            for (let x = 0; x < width; x += 1) {
                const alpha = data[(y * width + x) * 4 + 3];
                if (alpha <= 8) continue;
                if (label[gy * gw + Math.min(gw - 1, (x / step) | 0)] !== best) continue;
                weight += alpha; xsum += x * alpha;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
        if (!weight) return null;
        return { cx: xsum / weight, top, bottom };
    } catch { return null; } finally { canvas.width = canvas.height = 0; }
}
// 海报左右各半区：同一缩放、同一脚底线、左右镜像，看起来才是对称的一对。
async function mountPairOnFrame(first: HTMLImageElement, second: HTMLImageElement, options: PoseOptions, signal: AbortSignal, mimeType: "image/png" | "image/jpeg", loadFrame: FrameLoader): Promise<Blob> {
    const poster = await decode(await loadFrame(), signal); assertPoseActive(signal);
    const canvas = document.createElement("canvas");
    canvas.width = poster.naturalWidth; canvas.height = poster.naturalHeight;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("浏览器不支持 Canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(poster, 0, 0, canvas.width, canvas.height);
    const images = [first, second];
    const shapes = images.map((image, index) => alphaShape(image) ?? { cx: image.naturalWidth / 2, top: 0, bottom: image.naturalHeight - 1 });
    // 各自按“身体高度”缩放到同一目标高度：真人 1.8 米、机器人 1.8 米，看起来才一样大。
    const bodyHeights = shapes.map(shape => Math.max(1, shape.bottom - shape.top + 1));
    const targetBody = canvas.height * frameRoom(options.frameSize);
    const baseline = Math.round(canvas.height * 0.94);
    images.forEach((image, index) => {
        const shape = shapes[index];
        const scale = Math.min((canvas.width * 0.46) / image.naturalWidth, targetBody / bodyHeights[index]);
        const width = Math.round(image.naturalWidth * scale), height = Math.round(image.naturalHeight * scale);
        const x = Math.round(canvas.width * (index === 0 ? 0.36 : 0.67) - shape.cx * scale);
        const y = baseline - Math.round(shape.bottom * scale);
        ctx.save();
        ctx.shadowColor = "rgba(15, 23, 42, 0.35)";
        ctx.shadowBlur = Math.round(canvas.width * 0.01);
        ctx.shadowOffsetY = Math.round(canvas.width * 0.003);
        ctx.drawImage(image, x, y, width, height);
        ctx.restore();
    });
    assertPoseActive(signal);
    try { return await encode(canvas, signal, mimeType); } finally { canvas.width = canvas.height = 0; }
}
// 海报上主体能占的高度比例：小/中/大三档，默认中。
export function frameRoom(size?: "small" | "medium" | "large"): number {
    return size === "small" ? 0.62 : size === "large" ? 0.9 : 0.78;
}
async function mountOnFrame(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, options: PoseOptions, signal: AbortSignal, mimeType: "image/png" | "image/jpeg", loadFrame: FrameLoader): Promise<Blob> {
        const poster = await decode(await loadFrame(), signal); assertPoseActive(signal);
        const canvas = document.createElement("canvas");
        canvas.width = poster.naturalWidth; canvas.height = poster.naturalHeight;
        const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("浏览器不支持 Canvas");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(poster, 0, 0, canvas.width, canvas.height);
        // 海报正中央对称摆放：整组水平居中，高度约占 82%，上下留白相同；宽度不越过二维码。
        const room = frameRoom(options.frameSize);
        const scale = Math.min((canvas.width * 0.86) / sourceWidth, (canvas.height * room) / sourceHeight);
        const width = Math.round(sourceWidth * scale), height = Math.round(sourceHeight * scale);
        const x = Math.round((canvas.width - width) / 2), y = Math.round((canvas.height - height) / 2);
        // 不再垫白卡纸：透明动漫图直接贴在海报上，白底会把海报挡住一块。
        // 只用一层柔和投影把人物从背景里“托”起来，投影只落在图形的 alpha 边缘外面。
        ctx.save();
        ctx.shadowColor = "rgba(15, 23, 42, 0.35)";
        ctx.shadowBlur = Math.round(canvas.width * 0.01);
        ctx.shadowOffsetY = Math.round(canvas.width * 0.003);
        ctx.drawImage(source, x, y, width, height);
        ctx.restore();
        // 气泡由生图模型直接画进图里（见 bubbleSuffix），画布这里不再叠字。
        assertPoseActive(signal);
        try { return await encode(canvas, signal, mimeType); }
        finally { canvas.width = canvas.height = 0; }
}
