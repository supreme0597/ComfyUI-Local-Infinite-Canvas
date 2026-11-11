import { afterAll, expect, test } from "bun:test";
import { POSE_FRAME_URL, frameRoom, composePosePortrait, composeSinglePose, encodePoseImage, mangaAlpha, transparentPose } from "../src/services/pose-portrait-compositor";

const originals = { Image: Object.getOwnPropertyDescriptor(globalThis, "Image"), document: Object.getOwnPropertyDescriptor(globalThis, "document"), create: URL.createObjectURL, revoke: URL.revokeObjectURL, timeout: globalThis.setTimeout };
const draws: unknown[][] = [], strokes: unknown[][] = [], fills: unknown[][] = [], texts: unknown[][] = [], revoked: string[] = [], encodes: unknown[][] = [];
let decodeFailure = false, encodeFailure = false, holdDecode = false;
// 透明化要读像素：给假 canvas 一个可注入的帧缓冲，默认全绿幕。
let pixels = new Uint8ClampedArray(0);
const greenScreen = () => {
    const data = new Uint8ClampedArray(600 * 400 * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 0; data[i + 1] = 177; data[i + 2] = 64; data[i + 3] = 255; }
    return data;
};
class FakeImage {
    naturalWidth = 600; naturalHeight = 400; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(value: string) { if (!value) return; if (holdDecode) return; queueMicrotask(() => decodeFailure ? this.onerror?.() : this.onload?.()); }
}
const canvas = () => ({
    width: 0, height: 0,
    getContext: () => ({
        fillStyle: "", font: "", textAlign: "", textBaseline: "",
        fillRect: (...args: unknown[]) => fills.push(args),
        strokeRect: (...args: unknown[]) => strokes.push(args),
        drawImage: (...args: unknown[]) => draws.push(args),
        fillText: (...args: unknown[]) => texts.push(args),
        getImageData: () => ({ data: pixels }), putImageData: (frame: { data: Uint8ClampedArray }) => { pixels = frame.data; },
        save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {}, fill: () => {}, stroke: () => { strokes.push(["line"]); }, strokeStyle: "", lineWidth: 0, roundRect: () => {}, rect: () => {},
    }),
    toBlob: (callback: (blob: Blob | null) => void, mime: string, quality?: number) => {
        encodes.push([mime, quality]); callback(encodeFailure ? null : new Blob(["pixels"], { type: mime }));
    },
});
Object.defineProperty(globalThis, "Image", { configurable: true, value: FakeImage });
Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: canvas } });
URL.createObjectURL = () => `blob:test-${Math.random()}`;
URL.revokeObjectURL = value => { revoked.push(value); };
afterAll(() => {
    for (const key of ["Image", "document"] as const) {
        const old = originals[key];
        if (old) Object.defineProperty(globalThis, key, old); else Reflect.deleteProperty(globalThis, key);
    }
    URL.createObjectURL = originals.create; URL.revokeObjectURL = originals.revoke; globalThis.setTimeout = originals.timeout;
});

test("compositor draws both originals on a white base, paints the black divider and both labels", async () => {
    const beforeRevoked = revoked.length, beforeDraws = draws.length, beforeFills = fills.length, beforeTexts = texts.length;
    const signal = new AbortController().signal;
    const blob = await composePosePortrait(new Blob(), new Blob(), { layout: "horizontal", separator: "black", labels: true, style: "realistic" }, signal);
    expect(blob.type).toBe("image/png");
    expect(draws.length - beforeDraws).toBe(2);
    expect(fills.length - beforeFills).toBe(2);
    expect(texts.length - beforeTexts).toBe(2);
    expect(texts.at(-2)?.[0]).toBe("真人"); expect(texts.at(-1)?.[0]).toBe("机械角色");
    expect(revoked.length - beforeRevoked).toBe(2);
    expect(encodes.at(-1)).toEqual(["image/png", 0.92]);
});

test("the poster frame is reused as a background and the transparent art is placed straight on it", async () => {
    const beforeDraws = draws.length, beforeFills = fills.length;
    const signal = new AbortController().signal;
    const frame = new Blob(["poster"], { type: "image/webp" });
    let loads = 0;
    const blob = await composePosePortrait(new Blob(), new Blob(), { layout: "horizontal", separator: "white", labels: false, style: "toon", frame: "openeuler" }, signal, "image/png", async () => { loads += 1; return frame; });
    expect(blob.type).toBe("image/png");
    expect(loads).toBe(1);
    // 先把海报原图整幅铺满（0,0 全尺寸，不裁切、不变形），再把装裱后的二宫格叠上去。
    const sequence = draws.slice(beforeDraws);
    expect(sequence.some(row => JSON.stringify(row.slice(1)) === "[0,0,600,400]")).toBe(true);
    // 整幅海报 + 左右两张透明图，各自独立摆位（不再先拼一张二宫格）。
    const placed = sequence.filter(row => row.length === 5);
    expect(placed).toHaveLength(3);
    expect(sequence.at(-1)).toHaveLength(5);
    // 不再垫白卡纸、也不描相框：透明动漫图直接贴在海报上，不遮背景。
    expect(fills.length - beforeFills).toBe(0);
    expect(strokes.length).toBe(0);
    // 帧图只读复用：地址固定，不带任何改写参数。
    expect(POSE_FRAME_URL).toBe("/frames/openeuler-summit-2026.webp");
});

test("downloads convert at the requested quality and pass an already-correct format through", async () => {
    const signal = new AbortController().signal;
    expect((await encodePoseImage(new Blob(), signal, "image/jpeg")).type).toBe("image/jpeg");
    expect(encodes.at(-1)).toEqual(["image/jpeg", 0.92]);
    const already = new Blob(["pixels"], { type: "image/png" });
    const before = encodes.length;
    expect(await encodePoseImage(already, signal, "image/png")).toBe(already);
    expect(encodes.length).toBe(before);
});

test("decode and export failures reject without leaking decoded URLs", async () => {
    const before = revoked.length;
    decodeFailure = true;
    await expect(encodePoseImage(new Blob(), new AbortController().signal, "image/png")).rejects.toThrow("解码");
    expect(revoked.length).toBe(before + 1);
    decodeFailure = false; encodeFailure = true;
    await expect(encodePoseImage(new Blob(), new AbortController().signal, "image/png")).rejects.toThrow("导出");
    encodeFailure = false;
});

test("cancelling after decoding started rejects and still releases the object URL", async () => {
    const controller = new AbortController(); const before = revoked.length;
    holdDecode = true;
    try {
        const pending = composePosePortrait(new Blob(), new Blob(), { layout: "vertical", separator: "none", labels: false }, controller.signal);
        controller.abort();
        await expect(pending).rejects.toThrow("停止");
        expect(revoked.length).toBe(before + 1);
    } finally { holdDecode = false; }
});

test("a decode that never settles times out instead of hanging the panel", async () => {
    const controller = new AbortController(); const before = revoked.length;
    holdDecode = true;
    globalThis.setTimeout = ((handler: () => void) => { queueMicrotask(handler); return 0; }) as unknown as typeof setTimeout;
    try {
        await expect(composePosePortrait(new Blob(), new Blob(), { layout: "horizontal", separator: "white", labels: false }, controller.signal)).rejects.toThrow("超时");
        expect(revoked.length).toBeGreaterThan(before);
    } finally { globalThis.setTimeout = originals.timeout; holdDecode = false; }
});

test("a bubble is left to the model: the canvas never paints the bubble text", async () => {
    const beforeTexts = texts.length, beforeDraws = draws.length;
    const blob = await composePosePortrait(new Blob(), new Blob(), { layout: "horizontal", separator: "white", labels: false, bubble: "元气满满！" }, new AbortController().signal);
    expect(blob.type).toBe("image/png");
    expect(draws.slice(beforeDraws).filter(row => row.length === 5)).toHaveLength(2);
    expect(texts.slice(beforeTexts).map(args => args[0])).not.toContain("元气满满！");
});

test("manga style keeps a transparent background instead of painting white under the art", async () => {
    const beforeFills = fills.length;
    const signal = new AbortController().signal;
    const blob = await composePosePortrait(new Blob(), new Blob(), { layout: "horizontal", separator: "white", labels: false, style: "manga" }, signal);
    expect(blob.type).toBe("image/png");
    // 只有白色分隔条会 fillRect，整张白底不再铺，右格保持透明。
    const big = fills.slice(beforeFills).filter((args: unknown[]) => Number(args[2]) > 1000 || Number(args[3]) > 1000);
    expect(big.length).toBe(0);
});

test("white becomes fully transparent while ink stays opaque", () => {
    expect(mangaAlpha(255)).toBe(0);
    expect(mangaAlpha(250)).toBe(0);
    expect(mangaAlpha(0)).toBe(255);
    expect(mangaAlpha(128)).toBe(159);
    expect(mangaAlpha(Number.NaN)).toBe(0);
});

test("animated styles key both panels to transparency instead of painting a white base", async () => {
    const beforeFills = fills.length, beforeDraws = draws.length;
    const blob = await composePosePortrait(new Blob(), new Blob(), { layout: "horizontal", separator: "black", labels: false, style: "anime2d" }, new AbortController().signal);
    expect(blob.type).toBe("image/png");
    expect(draws.slice(beforeDraws).filter(row => row.length === 5)).toHaveLength(2);
    // 只画黑色分隔线，不再铺白底；两张图都是抠像后的透明图层。
    expect(fills.length - beforeFills).toBe(1);
});

test("transparent poses are cropped to the drawn pixels so the poster can show them big", async () => {
    const data = new Uint8ClampedArray(600 * 400 * 4);
    for (let y = 100; y < 200; y += 1) for (let x = 200; x < 300; x += 1) {
        const i = (y * 600 + x) * 4; data[i] = 20; data[i + 1] = 20; data[i + 2] = 20; data[i + 3] = 255;
    }
    pixels = data;
    const before = draws.length;
    await transparentPose(new Blob(), "toon", new AbortController().signal);
    const crop = draws.slice(before).filter(row => row.length === 9).at(-1);
    // 100x100 的实心块 + 2% 内边距 ≈ 116px，透明边不再占位置。
    expect(Number(crop?.[3])).toBeGreaterThanOrEqual(100);
    expect(Number(crop?.[3])).toBeLessThan(130);
    expect(encodes.at(-1)?.[0]).toBe("image/png");
});
test("transparent pose keys the green screen out and leaves hard edges alone", async () => {
    const beforeStrokes = strokes.length, beforeEncodes = encodes.length;
    pixels = greenScreen();
    // 第一个像素当主体（深色），其余全是绿幕。
    pixels[0] = 20; pixels[1] = 20; pixels[2] = 20; pixels[3] = 255;
    const blob = await transparentPose(new Blob(), "toon", new AbortController().signal);
    expect(blob.type).toBe("image/png");
    expect(pixels[3]).toBe(255);
    expect(pixels[7]).toBe(0);
    // 去溢色：绿通道向中性收敛，避免白线发绿。
    expect(pixels[5]).toBeLessThan(120);
    expect(encodes.slice(beforeEncodes).at(-1)?.[0]).toBe("image/png");
    // 不再本地补速度线（用户反馈像一圈怪线）；抠像只处理背景，不加装饰。
    expect(strokes.length).toBe(beforeStrokes);
});
test("poster art is centered and sized by the frame size option", async () => {
    const signal = new AbortController().signal;
    const poster = new Blob(["poster"], { type: "image/webp" });
    const load = async () => poster;
    const measure = async (frameSize: "small" | "medium" | "large") => {
        const before = draws.length;
        await composePosePortrait(new Blob(), new Blob(), { layout: "horizontal", separator: "none", labels: false, style: "toon", frame: "openeuler", frameSize }, signal, "image/png", load);
        const placed = draws.slice(before).filter(row => row.length === 5);
        return placed.slice(-2).map(row => ({ x: Number(row[1]), width: Number(row[3]), height: Number(row[4]) }));
    };
    const rects = await measure("medium");
    expect(frameRoom("small")).toBe(0.62); expect(frameRoom("medium")).toBe(0.78); expect(frameRoom("large")).toBe(0.9);
    // 锚点按用户要求不对称：真人 0.36、机器人 0.67，各自缩放到同一身体高度。
    expect(rects[1].x - rects[0].x).toBe(186);
    expect(rects[0].height).toBe(rects[1].height);
});
test("a single picture can be mounted on the poster without a grid", async () => {
    const before = draws.length;
    await composeSinglePose(new Blob(), { frame: "openeuler" } as never, new AbortController().signal, "image/png", async () => new Blob());
    const rows = draws.slice(before).filter(row => row.length === 5);
    // 海报铺满一次 + 这张单图装裱一次。
    expect(rows).toHaveLength(2);
    expect(rows[0]?.slice(1)).toEqual([0, 0, 600, 400]);
    expect(rows.at(-1)?.[2]).toBeLessThanOrEqual(600);
});

