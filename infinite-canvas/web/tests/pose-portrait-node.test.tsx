import { afterAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
afterAll(() => { if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage"); });
const { posePortraitDefinition, mergePoseSettings, upstreamImage, upstreamSource, stageNodeOps, stageStartOps, interruptedStageOps, tidyBubble, stepProgressOf, timerMeta } = await import("../src/components/canvas/nodes/pose-portrait-node");
const { collectImageStorageKeys } = await import("../src/services/image-storage");
import type { CanvasNodeContext } from "../src/types/canvas-plugin";

test("definition exposes a single creatable custom panel without automatic execution", () => {
    expect(posePortraitDefinition.type).toBe("builtin:pose-portrait"); expect(posePortraitDefinition.title).toBe("动作迁移合照");
    expect(posePortraitDefinition.defaultSize).toEqual({ width: 340, height: 260 });
    expect(posePortraitDefinition.showInCreateMenu).toBe(true); expect(posePortraitDefinition.autoOpenPanel).toBe(true);
    expect(posePortraitDefinition.hasSourceHandle).toBe(true);
    const ctx = { node: { id: "pose", metadata: {} }, ai: { defaultModel: () => "", listModels: () => [] }, getNode: () => null } as unknown as CanvasNodeContext;
    const Panel = posePortraitDefinition.Panel!, Content = posePortraitDefinition.Content!;
    const html = renderToStaticMarkup(<Panel ctx={ctx} onClose={() => {}} />);
    for (const text of ["真人照片", "固定机械角色", "动作识别引擎", "角色生成模型", "二宫格·左右（真人｜动漫角色）", "二宫格·上下（真人｜动漫角色）", "自然合照（模型重绘，会融合）", "一键生成", "对白气泡文字（留空不加）", "上传真人照片后自动开始", "后台 GPU"]) expect(html).toContain(text);
    expect(renderToStaticMarkup(<Content ctx={ctx} />)).toContain("动作迁移合照");
});
test("connected upstream image becomes the person photo without a second upload", () => {
    const node = { id: "img", width: 800, height: 600, metadata: { images: [{ id: "a", storageKey: "image:up", naturalWidth: 1024, naturalHeight: 768, mimeType: "image/png", content: "", status: "done", bytes: 1 }] } };
    expect(upstreamImage([{} as never, node as never])).toEqual({ storageKey: "image:up", width: 1024, height: 768, mimeType: "image/png" });
    expect(upstreamImage([{} as never])).toBeNull();
    // 图片节点的 storageKey 也可能只写在扁平 metadata 上；粘贴进来的图甚至只有 data URL。
    expect(upstreamImage([{ id: "flat", width: 300, height: 400, metadata: { storageKey: "image:flat", naturalWidth: 300, naturalHeight: 400 } } as never])).toEqual({ storageKey: "image:flat", width: 300, height: 400, mimeType: "image/png" });
    const pasted = upstreamSource([{ id: "paste", width: 120, height: 90, metadata: { content: "data:image/png;base64,AA" } } as never]);
    expect(pasted?.media).toBeNull(); expect(pasted?.dataUrl).toBe("data:image/png;base64,AA");
    expect(upstreamSource([{ id: "empty", width: 100, height: 100, metadata: {} } as never])).toBeNull();
    const theme = { toolbar: { panel: "rgb(250, 249, 246)", border: "rgb(214, 211, 209)" } };
    const ctx = { node: { id: "pose", metadata: {} }, theme, ai: { defaultModel: () => "", listModels: () => [] }, getNode: () => null, getUpstream: () => [node] } as unknown as CanvasNodeContext;
    const Panel = posePortraitDefinition.Panel!;
    expect(renderToStaticMarkup(<Panel ctx={ctx} onClose={() => {}} />)).toContain("已使用上游连线图片");
});
test("auto bubble text is cleaned to one short line", () => {
    expect(tidyBubble("「元气满满！」\n解释")).toBe("元气满满！");
    expect(tidyBubble("台词：比心")).toBe("比心");
    expect(tidyBubble("")).toBe("");
});
test("panel scrolls inside the canvas and result previews no longer open new tabs", () => {
    const ctx = { node: { id: "pose", metadata: {} }, ai: { defaultModel: () => "", listModels: () => [] }, getNode: () => null } as unknown as CanvasNodeContext;
    const Panel = posePortraitDefinition.Panel!;
    const html = renderToStaticMarkup(<Panel ctx={ctx} onClose={() => {}} />);
    // The canvas has a native non-passive wheel listener; without this marker the panel cannot scroll.
    expect(html).toContain("data-canvas-no-zoom");
    expect(html).not.toContain('target="_blank"');
});
test("panel paints an opaque surface like the builtin panels", () => {
    const theme = { toolbar: { panel: "rgb(250, 249, 246)", border: "rgb(214, 211, 209)" }, node: { text: "rgb(28, 25, 23)" } };
    const ctx = { node: { id: "pose", metadata: {} }, theme, ai: { defaultModel: () => "", listModels: () => [] }, getNode: () => null } as unknown as CanvasNodeContext;
    const Panel = posePortraitDefinition.Panel!;
    const html = renderToStaticMarkup(<Panel ctx={ctx} onClose={() => {}} />);
    // 宿主只挂载 Panel 本身，不提供底色；面板必须自己铺不透明表面，否则会透出画布。
    expect(html).toContain("rounded-2xl");
    expect(html).toContain("rgb(250, 249, 246)");
});
test("runs pin the chosen robot style and derive busy state from the shared run registry", async () => {
    const source = await Bun.file(new URL("../src/components/canvas/nodes/pose-portrait-node.tsx", import.meta.url)).text();
    expect(source).toContain('robotStyle: snapshot.robotStyle ?? "toon"');
    // 面板会被宿主反复卸载重建，忙碌状态必须来自组件外的运行表，否则新实例永远停在“处理中…”。
    expect(source).toContain("useSyncExternalStore");
    expect(source).toContain("notifyRuns()");
    // 反推端点对空结果抛错而不是返回空串，需要映射回可行动的空文本提示。
    expect(source).toContain('apiErrors.promptOptimizeEmpty');
});
test("run identifiers do not rely on the secure-context-only crypto.randomUUID", async () => {
    const source = await Bun.file(new URL("../src/components/canvas/nodes/pose-portrait-node.tsx", import.meta.url)).text();
    expect(source).not.toContain("crypto.randomUUID");
    expect(source).toContain("randomId()");
});
test("registered definition is visible to creation menu and existing image remains intact", async () => {
    const { registerBuiltinNodes } = await import("../src/components/canvas/nodes/builtin-nodes");
    const { getNodeDefinition, listNodeDefinitions } = await import("../src/lib/canvas/node-registry");
    registerBuiltinNodes();
    expect(getNodeDefinition("builtin:pose-portrait")).toBe(posePortraitDefinition);
    expect(listNodeDefinitions().some(def => def.type === "builtin:pose-portrait" && def.showInCreateMenu)).toBe(true);
    expect(getNodeDefinition("image")?.defaultSize.width).toBeGreaterThan(0);
});
test("settings merge preserves fixed role and concurrently added history; persistence has stable media keys", () => {
    const fixed = { storageKey: "image:fixed", width: 5, height: 5, mimeType: "image/png" };
    let latest: any = { metadata: { posePortrait: { layout: "horizontal", separator: "none", labels: false, character: fixed, history: [{ id: "new", action: { ...fixed, storageKey: "image:action" } }] } } };
    const patches: any[] = [];
    const ctx = { node: { id: "pose", metadata: {} }, getNode: () => latest, updateMetadata: (patch: any) => { patches.push(patch); latest = { ...latest, metadata: { ...latest.metadata, ...patch } }; } } as unknown as CanvasNodeContext;
    mergePoseSettings(ctx, { person: { ...fixed, storageKey: "image:person" }, characterModel: "channel::model" });
    expect(patches[0].posePortrait.character).toEqual(fixed); expect(patches[0].posePortrait.history).toHaveLength(1);
    const persisted = JSON.parse(JSON.stringify(patches[0]));
    expect([...collectImageStorageKeys(persisted)].sort()).toEqual(["image:action", "image:fixed", "image:person"]);
    expect(JSON.stringify(persisted)).not.toMatch(/apiKey|base64|blob:/);
});
test("panel exposes the 2d/realistic style choice and the generated-prompt stage", () => {
    const ctx = { node: { id: "pose", metadata: {} }, ai: { defaultModel: () => "", listModels: () => [] }, getNode: () => null } as unknown as CanvasNodeContext;
    const Panel = posePortraitDefinition.Panel!;
    const html = renderToStaticMarkup(<Panel ctx={ctx} onClose={() => {}} />);
    expect(html).toContain("机械角色画风");
    expect(html).toContain("日系2D卡通");
    expect(html).toContain("一键完成动作识别、提示词、角色与合照");
});

test("stage results become separate canvas nodes so the run is not a dead end", () => {
    const card = { id: "card-1", position: { x: 100, y: 200 }, width: 340, height: 260 };
    const media = (key: string, width: number, height: number) => ({ storageKey: key, width, height, mimeType: "image/png" });
    const run = {
        id: "r1", time: "2026-11-10T00:00:00.000Z", options: { layout: "grid-horizontal", separator: "white", labels: false },
        person: media("image:person", 400, 600), character: media("image:robot", 400, 600), characterModel: "image-qwen21",
        status: "done", stage: "output", pose: "双手在胸前比心",
        personArt: media("image:person-art", 600, 900), action: media("image:robot-art", 600, 900), output: media("image:out", 1200, 600),
    } as never;
    const ops = stageNodeOps(card, run, { personArt: "blob:person", action: "blob:robot", output: "blob:out" });
    expect(ops.map(op => op.type)).toEqual(["add_node", "add_node", "add_node", "add_node", "connect_nodes", "connect_nodes", "connect_nodes", "connect_nodes", "connect_nodes"]);
    expect(ops.filter(op => op.type === "add_node").map(op => ("title" in op ? op.title : ""))).toEqual(["动作识别文本", "真人照片动漫化", "机械角色动漫画", "合成合照"]);
    for (const op of ops) { if (op.type !== "add_node") continue; expect(op.width).toBe(300); }
    const text = ops[0]; if (text.type === "add_node") { expect(text.nodeType).toBe("text"); expect(text.metadata?.content).toBe("双手在胸前比心"); }
    const firstImage = ops[1]; if (firstImage.type === "add_node") { expect(firstImage.nodeType).toBe("image"); expect(firstImage.metadata?.storageKey).toBe("image:person-art"); expect(firstImage.metadata?.content).toBe("blob:person"); }
    // The chain is wired in reading order so the canvas shows the flow.
    const links = ops.filter(op => op.type === "connect_nodes");
    const adds = ops.filter(op => op.type === "add_node");
    expect(links.map(op => [op.fromNodeId, op.toNodeId])).toEqual([["card-1", adds[0].id], ["card-1", adds[1].id], [adds[0].id, adds[2].id], [adds[1].id, adds[3].id], [adds[2].id, adds[3].id]]);
    expect(new Set(adds.map(op => op.id)).size).toBe(4);
    // No pose -> no text node; missing media -> no image node.
    expect(stageNodeOps(card, { id: "r2", time: "t", options: { layout: "horizontal", separator: "white", labels: false }, person: media("image:p", 1, 1), character: media("image:c", 1, 1), characterModel: "m", status: "done", stage: "caption" } as never, {}).length).toBe(0);
});

test("a stage node appears exactly when that stage starts, one at a time", () => {
    const card = { id: "card-1", position: { x: 100, y: 200 }, width: 340, height: 260 };
    const media = (key: string) => ({ storageKey: key, width: 600, height: 900, mimeType: "image/png" });
    const state = { ids: {}, heights: {}, links: new Set<string>() };
    const run = (stage: string) => ({ id: "r1", time: "t", options: { layout: "grid-horizontal", separator: "white", labels: false }, person: media("image:p"), character: media("image:c"), characterModel: "m", status: "running", stage } as never);
    // 第一张（动作识别）开跑：只放这一个节点 + 卡片到它的连线 + 计时。
    const first = stageStartOps(card, run("caption"), state, 1000);
    expect(first.filter(op => op.type === "add_node").map(op => ("title" in op ? op.title : ""))).toEqual(["动作识别文本"]);
    expect(first.filter(op => op.type === "connect_nodes").length).toBe(1);
    expect(first.at(-1)).toMatchObject({ type: "update_node", metadata: { generationStartedAt: 1000, previewStep: 1, previewTotal: 4 } });
    // 同一阶段再次保存：不重复建节点，只补计时。
    expect(stageStartOps(card, run("caption"), state, 1200).filter(op => op.type === "add_node").length).toBe(0);
    // 第二阶段：此时才出现第二张，并连上卡片。
    const second = stageStartOps(card, run("person"), state, 5000);
    expect(second.filter(op => op.type === "add_node").map(op => ("title" in op ? op.title : ""))).toEqual(["真人照片动漫化"]);
    expect(second.filter(op => op.type === "connect_nodes").length).toBe(1);
    // 第三阶段：文本 → 角色的连线在这时才补上。
    const third = stageStartOps(card, run("character"), state, 9000);
    expect(third.filter(op => op.type === "add_node").map(op => ("title" in op ? op.title : ""))).toEqual(["机械角色动漫画"]);
    expect(third.some(op => op.type === "connect_nodes" && op.fromNodeId === state.ids.text && op.toNodeId === state.ids.action)).toBe(true);
});

test("a finished stage fills its own placeholder instead of adding another node", () => {
    const card = { id: "card-1", position: { x: 100, y: 200 }, width: 340, height: 260 };
    const media = (key: string) => ({ storageKey: key, width: 600, height: 900, mimeType: "image/png" });
    const state = { ids: {}, heights: {}, links: new Set<string>() };
    const base = { id: "r1", time: "t", options: { layout: "grid-horizontal", separator: "white", labels: false }, person: media("image:p"), character: media("image:c"), characterModel: "m", status: "running", stage: "caption" } as never;
    stageStartOps(card, base, state, 1000);
    stageStartOps(card, { ...base, stage: "person" } as never, state, 2000);
    stageStartOps(card, { ...base, stage: "character" } as never, state, 3000);
    const filled = stageNodeOps(card, { ...base, stage: "character", pose: "双手比心", personArt: media("image:pa") } as never, { personArt: "blob:pa" }, state);
    expect(filled.filter(op => op.type === "add_node").length).toBe(0);
    const updates = filled.filter(op => op.type === "update_node");
    const person = updates.find(op => op.id === state.ids.person) as { metadata: Record<string, unknown> };
    expect(person.metadata.status).toBe("success");
    expect(person.metadata.storageKey).toBe("image:pa");
    // 回填时必须把 loading 期的计时/步数清掉，否则会一直显示“生成中 2/4”。
    expect(person.metadata.generationStartedAt).toBeUndefined();
    expect(person.metadata.previewStep).toBeUndefined();
    expect(person.metadata.previewTotal).toBeUndefined();
});

test("stage image nodes carry the model, prompt and provenance instead of being anonymous artifacts", () => {
    const card = { id: "card-1", position: { x: 100, y: 200 }, width: 340, height: 260 };
    const media = (key: string) => ({ storageKey: key, width: 600, height: 900, mimeType: "image/png" });
    const run = {
        id: "r9", time: "2026-11-10T00:00:00.000Z", options: { layout: "grid-horizontal", separator: "white", labels: false },
        person: media("image:person"), character: media("image:robot"), characterModel: "image-qwen21", robotStyle: "toon",
        status: "done", stage: "output", pose: "双手比心", personPrompt: "人物提示词", actionPrompt: "角色提示词",
        personArt: media("image:person-art"), action: media("image:robot-art"), output: media("image:out"),
    } as never;
    const ops = stageNodeOps(card, run, { personArt: "blob:person", action: "blob:robot", output: "blob:out" });
    const images = ops.filter(op => op.type === "add_node" && op.nodeType === "image");
    expect(images.map(op => ("metadata" in op ? (op.metadata as Record<string, unknown>).prompt : ""))).toEqual(["人物提示词", "角色提示词", undefined]);
    for (const op of images) {
        const metadata = (op as { metadata: Record<string, unknown> }).metadata;
        expect(metadata.model).toBe("image-qwen21");
        expect(metadata.imageMode).toBe("edit");
        expect((metadata.poseStage as Record<string, unknown>).stage).toBeString();
        expect((metadata.poseStage as Record<string, unknown>).runId).toBe("r9");
    }
});

test("panel offers an explicit prompt source and records it in the run snapshot", () => {
    const source = readFileSync("src/components/canvas/nodes/pose-portrait-node.tsx", "utf8");
    expect(source).toContain("提示词来源");
    expect(source).toContain('promptMode: snapshot.promptMode ?? "model"');
    expect(source).toContain("模型看图各写一段");
});

test("progress rides the host's border ring instead of a bar painted inside the card", async () => {
    const run = (stage: string, status = "running", layout = "grid-horizontal") => ({ id: "r", time: "", status, stage, options: { layout } } as never);
    expect(stepProgressOf(null)).toBeNull();
    expect(stepProgressOf(run("caption"))).toEqual({ step: 1, total: 4 });
    expect(stepProgressOf(run("person"))).toEqual({ step: 2, total: 4 });
    expect(stepProgressOf(run("character"))).toEqual({ step: 3, total: 4 });
    expect(stepProgressOf(run("output"))).toEqual({ step: 4, total: 4 });
    expect(stepProgressOf(run("prompt", "running", "natural"))).toEqual({ step: 2, total: 5 });
    expect(stepProgressOf(run("output", "done"))).toEqual({ step: 4, total: 4, complete: true });
    const source = await Bun.file(new URL("../src/components/canvas/nodes/pose-portrait-node.tsx", import.meta.url)).text();
    expect(source).toContain("stepProgress");
    expect(source).not.toContain("progressbar");
    const ctx = { node: { id: "pose", metadata: {} }, ai: { defaultModel: () => "", listModels: () => [] }, getNode: () => null } as unknown as CanvasNodeContext;
    const Card = posePortraitDefinition.Content!;
    expect(renderToStaticMarkup(<Card ctx={ctx} />)).not.toContain("progressbar");
    expect(renderToStaticMarkup(<Card ctx={ctx} />)).toContain("动作迁移合照");
});

test("no progress ring is left behind after an interrupted run", async () => {
    const source = await Bun.file(new URL("../src/components/canvas/nodes/pose-portrait-node.tsx", import.meta.url)).text();
    expect(source).toContain("!leftover.complete");
    expect(source).toContain("!ACTIVE_RUNS.has(ctxRef.current.node.id) && ctxRef.current.getNode");
});

test("the card reports a start time so the host can draw its elapsed badge while running", () => {
    expect(timerMeta(1_000, false, 5_500)).toEqual({ generationStartedAt: 1_000, generationDurationMs: undefined });
    expect(timerMeta(1_000, true, 4_000)).toEqual({ generationStartedAt: undefined, generationDurationMs: 3_000 });
    expect(timerMeta(undefined, true, 4_000)).toEqual({ generationStartedAt: undefined, generationDurationMs: undefined });
    const source = readFileSync(new URL("../src/components/canvas/nodes/pose-portrait-node.tsx", import.meta.url), "utf8");
    // metadata.generationStartedAt is what canvas-node.tsx:347 reads for the top-left badge.
    expect(source).toContain("generationStartedAt");
    expect(source).not.toContain("RUN_STATE");
});
