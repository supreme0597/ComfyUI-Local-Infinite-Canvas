import { expect, test } from "bun:test";
import { runPosePortrait, poseGeometry, poseImageRequest, poseSettingsDefaults, characterPrompt, personPrompt, promptSheetInstruction, promptSheetGeometry, POSE_IMAGE_MODE, type PoseRun, type PoseDependencies } from "../src/lib/canvas/pose-portrait";
const media = (id: string) => ({ storageKey: `image:${id}`, width: 600, height: 400, mimeType: "image/png" });
const create = (layout: PoseRun["options"]["layout"] = "natural"): PoseRun => ({ id: "new", time: "now", options: { layout, separator: "none", labels: false, output: "grid" }, person: media("person"), character: media("fixed"), characterModel: "one", portraitModel: "two", engine: "qwen35", status: "running", stage: "caption" });
function harness(run: PoseRun, controller = new AbortController()) {
    const calls: unknown[][] = [], saved: PoseRun[] = [];
    const deps: PoseDependencies = {
        caption: async () => { calls.push(["caption"]); return "左手举起"; },
        describe: async () => { calls.push(["describe"]); return "整段提示词"; },
        generate: async (prompt, model, refs) => { calls.push(["generate", prompt, model, refs]); return media(model === "one" ? "fresh" : "portrait"); },
        compose: async (...args) => { calls.push(["compose", ...args]); return media("layout"); },
        save: (value) => saved.push(value), isActive: () => true,
    };
    return { deps, calls, saved, controller, execute: () => runPosePortrait(run, deps, controller.signal) };
}
test("natural run uses caption body and fresh references in fixed order; snapshots do not mutate", async () => {
    const h = harness(create()); await h.execute();
    expect(h.calls.map(c => c[0])).toEqual(["caption", "describe", "generate", "generate", "generate"]);
    expect(h.calls[2][1]).toContain("左手举起"); expect(h.calls[2][2]).toBe("one");
    expect(h.calls[2][3]).toEqual([media("person")]);
    expect(h.calls[3][1]).toContain("左手举起"); expect(h.calls[3][3]).toEqual([media("fixed")]);
    expect(h.calls[4][2]).toBe("two"); expect(h.calls[4][3]).toEqual([media("fresh"), media("fresh")]);
    expect(h.saved.at(-1)?.status).toBe("done"); expect(h.saved[0].output).toBeUndefined();
    expect(h.saved.some(s => s.pose && !s.action)).toBe(true);
    expect(h.saved.some(s => s.action && !s.output)).toBe(true);
});
test("runner refuses missing model before submitting any request", async () => {
    for (const key of ["characterModel", "portraitModel"] as const) {
        const run = create(); run[key] = "";
        const h = harness(run); await h.execute(); expect(h.calls).toHaveLength(0); expect(h.saved.at(-1)?.status).toBe("error");
    }
});
test("empty caption is actionable, while transport errors do not leak secrets", async () => {
    const h = harness(create()); h.deps.caption = async () => ""; await h.execute(); expect(h.saved.at(-1)?.error).toContain("空文本");
    const a = harness(create()); a.deps.caption = async () => { throw Error("sk-private data:secret blob:secret"); }; await a.execute();
    expect(JSON.stringify(a.saved)).not.toMatch(/sk-private|data:secret|blob:secret/);
});
test("media adapters cannot persist transient URLs or mutate saved inputs", async () => {
    const h = harness(create());
    h.deps.generate = async (_prompt, _model, refs) => { refs[0].width = 1; return { ...media("fresh"), url: "blob:transient" }; };
    await h.execute();
    expect(JSON.stringify(h.saved)).not.toContain("blob:");
    expect(h.saved.at(-1)?.character.width).toBe(600);
    expect(h.saved.at(-1)?.person.width).toBe(600);
});
test("all local layouts skip final generation", async () => {
    for (const layout of ["horizontal", "vertical", "grid-horizontal", "grid-vertical"] as const) {
        const h = harness(create(layout)); await h.execute();
        // 本地拼接不需要整段提示词：既省一次反推请求，也避免反推失败拖垮纯本地输出。
        expect(h.calls.map(c => c[0])).toEqual(["caption", "generate", "generate", "compose"]);
        expect(h.saved.at(-1)?.output?.storageKey).toBe("image:layout");
    }
});
test("empty caption and stage errors stop without fallback", async () => {
    const h = harness(create()); h.deps.caption = async () => "  "; await h.execute();
    expect(h.calls).toHaveLength(0); expect(h.saved.at(-1)?.status).toBe("error");
    const a = harness(create()); a.deps.generate = async () => { throw Error("failed"); }; await a.execute();
    expect(a.calls.map(c => c[0])).toEqual(["caption", "describe"]); expect(a.saved.at(-1)?.pose).toBe("左手举起");
    expect(a.saved.at(-1)?.output).toBeUndefined();
});
test("cancellation after every async boundary prevents subsequent stages", async () => {
    const expected: Record<string, string[]> = { caption: ["caption"], describe: ["caption", "describe"], generate: ["caption", "describe", "generate"], compose: ["caption", "generate", "generate", "compose"] };
    for (const boundary of ["caption", "describe", "generate", "compose"] as const) {
        const h = harness(create(boundary === "compose" ? "horizontal" : "natural"));
        const original = h.deps[boundary];
        if (boundary === "caption") h.deps.caption = async signal => { const r = await (original as PoseDependencies["caption"])(signal); h.controller.abort(); return r; };
        else if (boundary === "generate") h.deps.generate = async (...args) => { const r = await (original as PoseDependencies["generate"])(...args); h.controller.abort(); return r; };
        else if (boundary === "describe") h.deps.describe = async signal => { const r = await (original as PoseDependencies["describe"])(signal); h.controller.abort(); return r; };
        else h.deps.compose = async (...args) => { const r = await (original as PoseDependencies["compose"])(...args); h.controller.abort(); return r; };
        await h.execute();
        expect(h.calls.map(c => c[0])).toEqual(expected[boundary]);
        expect(h.saved.at(-1)?.status).toBe("stopped");
        expect(h.saved.at(-1)?.stage).toBe({ caption: "caption", describe: "prompt", generate: "person", compose: "output" }[boundary]);
    }
});
test("inactive run submits nothing and old results are cleared", async () => {
    const run = create(); run.pose = "old"; run.action = media("old"); run.output = media("old");
    const h = harness(run); h.deps.isActive = () => false; await h.execute();
    expect(h.calls).toHaveLength(0); expect(h.saved.at(-1)?.output).toBeUndefined();
});
test("geometry contains images, separates, reserves labels, and caps output", () => {
    for (const layout of ["horizontal", "vertical", "grid-horizontal", "grid-vertical"] as const) {
        const g = poseGeometry({ width: 10000, height: 1000 }, { width: 1000, height: 8000 }, { layout, separator: "white", labels: true });
        expect(Math.max(g.width, g.height)).toBeLessThanOrEqual(4096);
        for (const value of [g.width, g.height, g.fontSize, ...g.images.flatMap(r => [r.x, r.y, r.width, r.height]), ...g.labels.flatMap(r => [r.x, r.y, r.width, r.height])]) expect(Number.isInteger(value)).toBe(true);
        for (const [i, r] of g.images.entries()) {
            expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
            expect(r.x + r.width).toBeLessThanOrEqual(g.width); expect(r.y + r.height).toBeLessThanOrEqual(g.height);
            const expected = i === 0 ? 10 : 0.125;
            expect(Math.abs(r.width / r.height - expected) / expected).toBeLessThan(0.01);
        }
        // Both pictures stay separate, and neither is drawn over a caption band.
        const [a, b] = g.images;
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
        for (const r of g.images) for (const l of g.labels) expect(r.y + r.height <= l.y || l.y + l.height <= r.y || r.x + r.width <= l.x || l.x + l.width <= r.x).toBe(true);
        expect(g.labels).toHaveLength(2); expect(g.separator).toBeDefined();
        expect(g.separator!.width).toBeGreaterThanOrEqual(1); expect(g.separator!.height).toBeGreaterThanOrEqual(1);
    }
    const tight = poseGeometry({ width: 4032, height: 3024 }, { width: 3024, height: 4032 }, { layout: "horizontal", separator: "none", labels: false });
    expect(tight.separator).toBeUndefined(); expect(tight.labels).toHaveLength(0);
    expect(tight.images[0].x + tight.images[0].width).toBe(tight.images[1].x);
    const line = poseGeometry({ width: 100, height: 100 }, { width: 100, height: 100 }, { layout: "vertical", separator: "black", labels: false });
    expect(line.separator!.height).toBeGreaterThanOrEqual(1);
    expect(() => poseGeometry({ width: 0, height: 1 }, media("x"), { layout: "horizontal", separator: "none", labels: false })).toThrow();
});

test("image requests force edit mode so the gateway reads the reference image", () => {
    const controller = new AbortController();
    const request = poseImageRequest("image-qwen21", ["data:image/png;base64,one"], controller.signal);
    expect(POSE_IMAGE_MODE).toBe("edit");
    expect(request).toEqual({ model: "image-qwen21", count: 1, references: ["data:image/png;base64,one"], mode: "edit", signal: controller.signal });
    // 回归保护：网关只在顶层 mode="edit" 时读参考图，缺失或多包一层都会退化为文生图。
    expect(request.mode).toBe("edit");
});

test("a generated sheet prompt drives the final image instead of a fixed template", async () => {
    const h = harness(create());
    h.deps.describe = async () => "生成一张以真人参考图中的男性与角色参考图中的机械角色并肩为主体的日式漫画风格图片，右拳置于胸前。";
    await h.execute();
    expect(h.calls.map(c => c[0])).toEqual(["caption", "generate", "generate", "generate"]);
    expect(h.calls[3][1]).toBe("生成一张以真人参考图中的男性与角色参考图中的机械角色并肩为主体的日式漫画风格图片，右拳置于胸前。");
    expect(h.calls[3][1]).not.toContain("图1是真人原图");
    expect(h.saved.at(-1)?.prompt).toBe(h.calls[3][1]);
});
test("an empty generated prompt fails before spending an image request", async () => {
    const h = harness(create());
    h.deps.describe = async () => "   ";
    await h.execute();
    expect(h.calls.map(c => c[0])).toEqual(["caption"]);
    expect(h.saved.at(-1)?.status).toBe("error");
    expect(h.saved.at(-1)?.error).toContain("空文本");
});
test("robot style drives both the character prompt and the sheet instruction", () => {
    const anime = characterPrompt("右拳置于胸前", "anime2d"), real = characterPrompt("右拳置于胸前", "realistic");
    expect(anime).toContain("平涂"); expect(real).not.toContain("平涂"); expect(real).toContain("右拳置于胸前");
    expect(anime.indexOf("日系2D")).toBeLessThan(anime.indexOf("目标动作："));
    expect(anime).not.toContain("原有画风");
    expect(promptSheetInstruction("anime2d")).toContain("日系2D卡通动画风格");
    expect(promptSheetInstruction("realistic")).toContain("保持参考图中的实拍质感");
    expect(promptSheetInstruction("realistic")).not.toContain("日系2D");
    // 不能预设真人性别，否则女性或儿童照片会被提示词改写身份。
    expect(promptSheetInstruction("anime2d")).not.toContain("男性");
    expect(promptSheetInstruction("anime2d")).toContain("图片1为真人原图");
    // 用户要求机器人要真动漫元素，不是单纯平涂。
    for (const mark of ["集中线", "速度线", "网点"]) expect(anime).toContain(mark);
    expect(promptSheetInstruction("anime2d")).toContain("集中线");
    expect(promptSheetInstruction("realistic")).not.toContain("集中线");
});
test("robot style is explicit: clean cartoon by default, anime 2d, manga and realistic on request", () => {
    const anime = characterPrompt("右手握拳", "anime2d"), real = characterPrompt("右手握拳", "realistic");
    expect(anime).toContain("平涂"); expect(anime).toContain("粗描边"); expect(anime).toContain("右手握拳");
    expect(real).not.toContain("平涂"); expect(real).toContain("右手握拳");
    expect(anime).not.toBe(real);
    expect(poseSettingsDefaults().robotStyle).toBe("toon");
    const manga = characterPrompt("右手握拳", "manga");
    // 黑白漫画必须是纯黑白、白底，并保留演出元素；默认不能被替换成彩色动漫。
    expect(manga).toContain("黑白漫画"); expect(manga).toContain("无彩色"); expect(manga).toContain("集中线");
    expect(manga).not.toContain("明亮饱和");
    expect(manga).toContain("#00B140");
    expect(promptSheetGeometry({ width: 600, height: 900 }, { width: 1080, height: 1296 })).toEqual({ width: 1536, height: 1024, cells: [{ x: 0, y: 0, width: 768, height: 1024 }, { x: 768, y: 0, width: 768, height: 1024 }], fits: [{ width: 682, height: 1024 }, { width: 768, height: 921 }] });
});
test("bubble text is real text: grid composes locally, natural appends it to the model prompt", async () => {
    const grid = create("horizontal"); grid.options = { ...grid.options, bubble: "元气满满！" };
    const h = harness(grid); await h.execute();
    expect(h.calls.map(c => c[0])).toEqual(["caption", "generate", "generate", "compose"]);
    expect((h.calls[3][3] as { bubble?: string }).bubble).toBe("元气满满！");
    const natural = create(); natural.options = { ...natural.options, bubble: "元气满满！" };
    const n = harness(natural); n.deps.describe = async () => { n.calls.push(["describe"]); return "生成的提示词"; };
    await n.execute();
    const prompt = String(n.calls.at(-1)?.[1] || "");
    // 气泡指令放最前面，模型才肯画；提示词正文跟在后面。
    expect(prompt.indexOf("元气满满！")).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf("元气满满！")).toBeLessThan(prompt.indexOf("生成的提示词"));
});

test("auto bubble asks the model for one line and never fails the run", async () => {
    const grid = create("horizontal"); grid.options = { ...grid.options, bubbleAuto: true };
    const h = harness(grid); h.deps.bubble = async (pose) => { h.calls.push(["bubble", pose]); return "比心！"; };
    await h.execute();
    // 气泡文字在出图前就定好（模型直画气泡时要用），所以顺序是 caption → bubble → 两张画 → 合成。
    expect(h.calls.map(c => c[0])).toEqual(["caption", "bubble", "generate", "generate", "compose"]);
    expect((h.calls.at(-1)?.[3] as { bubble?: string; bubbleAuto?: boolean }).bubble).toBe("比心！");
    expect(h.saved.at(-1)?.status).toBe("done");
    const run = create("horizontal"); run.options = { ...run.options, bubbleAuto: true };
    const h2 = harness(run); h2.deps.bubble = async () => { throw new Error("model offline"); };
    await h2.execute();
    expect(h2.saved.at(-1)?.status).toBe("done");
    expect(h2.saved.at(-1)?.options.bubble).toBe("冲！");
});
test("person prompt animates the real photo in the same style and refuses realistic", () => {
    const anime = personPrompt("左手举起", "anime2d");
    expect(anime).toContain("左手举起");
    expect(anime).toContain("保留其面部特征");
    expect(anime).toContain("集中线");
    expect(anime).not.toContain("机器人");
    const manga = personPrompt("左手举起", "manga");
    expect(manga).toContain("#00B140");
    expect(manga).toContain("黑白");
    expect(() => personPrompt("左手举起", "realistic")).toThrow();
});

test("cartoon frames leave an outer white margin so borders never touch the edge", () => {
    const plain = poseGeometry({ width: 832, height: 1248 }, { width: 960, height: 1088 }, { layout: "grid-horizontal", separator: "white", labels: false });
    const toon = poseGeometry({ width: 832, height: 1248 }, { width: 960, height: 1088 }, { layout: "grid-horizontal", separator: "white", labels: false, style: "toon" });
    expect(toon.width).toBeGreaterThan(plain.width);
    expect(toon.height).toBeGreaterThan(plain.height);
    expect(toon.images[0].x).toBeGreaterThan(0);
    expect(toon.images[0].y).toBeGreaterThan(0);
    const right = toon.images[1].x + toon.images[1].width;
    expect(toon.width - right).toBeGreaterThan(0);
});

test("stage results are mirrored into the caller run so the panel can publish them", async () => {
    const run = create(), h = harness(run); await h.execute();
    expect(h.saved.at(-1)?.status).toBe("done");
    expect(run.status).toBe("done");
    expect(run.pose).toContain("手");
    expect(run.personArt?.storageKey).toBe("image:fresh");
    expect(run.action?.storageKey).toBe("image:fresh");
    expect(run.output?.storageKey).toBe("image:portrait");
    const grid = create("grid-horizontal"), g = harness(grid); await g.execute();
    expect(grid.output?.storageKey).toBe("image:layout");
});

test("auto bubble never disappears: a local line fills in when no text model answers", async () => {
    const run = create("grid-horizontal"); run.options.bubbleAuto = true;
    const h = harness(run); h.deps.caption = async () => "双手在脸前比出爱心"; h.deps.bubble = async () => ""; await h.execute();
    expect(h.saved.at(-1)?.options.bubble).toBe("比心！");
    expect(h.calls.filter(c => c[0] === "compose")[0][3]?.bubble).toBe("比心！");
    const plain = create("grid-horizontal"); plain.options.bubbleAuto = true;
    const p = harness(plain); p.deps.bubble = async () => { throw new Error("no model"); }; await p.execute();
    expect(p.saved.at(-1)?.status).toBe("done");
    expect(poseSettingsDefaults().bubbleAuto).toBe(true);
});

test("model-written art prompts become the scene notes after a fixed style head, while template mode skips the model", async () => {
    const auto = harness(create("grid-horizontal"));
    auto.deps.describeArt = async (kind) => { auto.calls.push(["describeArt", kind]); return kind === "person" ? "人物提示词" : "角色提示词"; };
    await auto.execute();
    const prompts = auto.calls.filter(call => call[0] === "generate").map(call => call[1]);
    expect(prompts[0]).toContain("人物提示词");
    expect(prompts[0]).toContain("卡通");
    expect(prompts[1]).toContain("角色提示词");
    expect(prompts[1]).toContain("机械");
    expect(auto.saved.at(-1)?.personPrompt).toContain("人物提示词");
    expect(auto.saved.at(-1)?.actionPrompt).toContain("角色提示词");
    const fixed = harness(create("grid-horizontal"));
    fixed.deps.describeArt = async () => { throw new Error("must not be called"); };
    await runPosePortrait({ ...create("grid-horizontal"), options: { layout: "grid-horizontal", separator: "white", labels: false, promptMode: "template" } }, fixed.deps, fixed.controller.signal);
    expect(fixed.calls.filter(call => call[0] === "generate").map(call => call[1])).toEqual([personPrompt("左手举起", "toon"), characterPrompt("左手举起", "toon")]);
});
test("a failing art prompt falls back to the fixed template instead of failing the run", async () => {
    const h = harness(create("grid-horizontal"));
    h.deps.describeArt = async () => { throw new Error("caption endpoint down"); };
    await h.execute();
    expect(h.saved.at(-1)?.status).toBe("done");
    expect(h.calls.filter(call => call[0] === "generate")).toHaveLength(2);
});

test("a model-written art prompt still carries the chosen style, so the photo is redrawn instead of copied", async () => {
    const h = harness(create("grid-horizontal"));
    h.deps.describeArt = async (kind) => kind === "person" ? "年轻男性，双手在胸前比心" : "白色装甲机器人，右拳抬起";
    await h.execute();
    const [person, character] = h.calls.filter(call => call[0] === "generate").map(call => String(call[1]));
    expect(person).toContain("年轻男性，双手在胸前比心");
    expect(person).toContain("卡通");
    expect(character).toContain("白色装甲机器人，右拳抬起");
    expect(character).toContain("机械");
    // 动作必须由动作识别文本兜底：模型写的角色描述常常只聊造型，漏掉手势，机器人就会站着不动。
    expect(character).toContain("左手举起");
    expect(person).toContain("左手举起");
});

test("the character stage can read the real photo as a second reference so hand shape is copied, not guessed", async () => {
    const run = create("grid-horizontal"); run.characterInputs = 2;
    const h = harness(run); await h.execute();
    const generates = h.calls.filter(call => call[0] === "generate");
    expect(generates[1][3]).toEqual([media("fixed"), media("fresh")]);
    expect(String(generates[1][1])).toContain("图片2");
    expect(String(generates[1][1])).toContain("不要把人");
    const single = harness(create("grid-horizontal")); await single.execute();
    const singles = single.calls.filter(call => call[0] === "generate");
    expect(singles[1][3]).toEqual([media("fixed")]);
});
test("the robot prompt forbids clasped or crossed fingers, which reads as the wrong gesture", () => {
    const anime = characterPrompt("双手在胸前合拢，指尖相对", "toon");
    expect(anime).toContain("指尖相对");
    expect(anime).toContain("不要交叉互握");
});
test("single output stops after the character stage and hands back that one picture", async () => {
    const run = create("grid-horizontal"); run.options.output = "single";
    const h = harness(run); await h.execute();
    // 不拼二宫格：只到角色图为止，不再调用本地合成，也不生成合照。
    expect(h.calls.map(call => call[0])).toEqual(["caption", "generate", "generate"]);
    expect(h.saved.at(-1)?.status).toBe("done");
    expect(h.saved.at(-1)?.output?.storageKey).toBe("image:fresh");
});
test("cartoon art is keyed to transparent PNG before it is stored, while realistic keeps the photo", async () => {
    const run = create("grid-horizontal"); run.options.output = "single"; run.options.style = "toon";
    const h = harness(run), alphas: unknown[][] = [];
    h.deps.alpha = async (item, style) => { alphas.push([item.storageKey, style]); return media(`flat-${item.storageKey.slice(6)}`); };
    await h.execute();
    // 两张模型生成的动漫画都过一遍抠像；真人原图不动（要保留照片本身）。
    expect(alphas).toEqual([["image:fresh", "toon"], ["image:fresh", "toon"]]);
    expect(h.saved.at(-1)?.output?.storageKey).toBe("image:flat-fresh");
    // 写实画风保留照片：不跑抠像，也不应把 alpha 依赖当成必需项。
    const real = create("grid-horizontal"); real.options.output = "single"; real.robotStyle = "realistic"; real.options.style = "realistic";
    const r = harness(real), skipped: string[] = [];
    r.deps.alpha = async (item) => { skipped.push(item.storageKey); return item; };
    await r.execute();
    expect(skipped).toEqual([]);
    expect(r.saved.at(-1)?.output?.storageKey).toBe("image:fresh");
});
test("single output with the poster frame still composes both arts onto the poster without a white card", async () => {
    const run = create("grid-horizontal"); run.options.output = "single"; run.options.frame = "openeuler"; run.options.frameSource = "upload";
    const h = harness(run);
    await h.execute();
    // 海报模式下单张开关也要走本地合成：把两张动漫图并排直接贴到海报上，不垫白卡纸。
    expect(h.calls.map(call => call[0])).toEqual(["caption", "generate", "generate", "compose"]);
    expect(h.saved.at(-1)?.status).toBe("done");
    // 没有海报时单张模式直接交回这张图，不跑本地合成。
    const plain = create("grid-horizontal"); plain.options.output = "single"; plain.options.frame = "none";
    const p = harness(plain);
    await p.execute();
    expect(p.calls.map(call => call[0])).toEqual(["caption", "generate", "generate"]);
    expect(p.saved.at(-1)?.output?.storageKey).toBe("image:fresh");
});

test("model-drawn bubbles go into the painting prompt and never into the canvas", async () => {
    const run = create("horizontal"); run.options = { ...run.options, bubble: "点赞！" };
    const h = harness(run); await h.execute();
    const prompts = h.calls.filter(c => c[0] === "generate").map(c => String(c[1]));
    expect(prompts).toHaveLength(2);
    // 气泡只进机械角色那张，避免两张各冒一个气泡。
    expect(prompts[0]).not.toContain("点赞！");
    expect(prompts[1]).toContain("点赞！");
    const plain = { layout: "horizontal" as const, separator: "white" as const, labels: false };
    // 本地画布不画气泡，也不为气泡留白带：有没有气泡文字，几何完全一致。
    expect(poseGeometry({ width: 3, height: 4 }, { width: 3, height: 4 }, { ...plain, bubble: "点赞！" })).toEqual(poseGeometry({ width: 3, height: 4 }, { width: 3, height: 4 }, plain));
});
