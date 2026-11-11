import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from "react";
import { Users } from "lucide-react";
import { saveAs } from "file-saver";
import { randomId } from "@/lib/utils";
import { useEffectiveConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { poseModelInputs, poseModelOptions, resolvePoseConfig } from "@/lib/canvas/pose-portrait-config";
import { assertPoseActive, poseImageRequest, poseSettingsDefaults, promptSheetInstruction, BUBBLE_INSTRUCTION, PERSON_ART_INSTRUCTION, ROBOT_ART_INSTRUCTION, POSE_INSTRUCTION, runPosePortrait, type PoseMedia, type PoseOptions, type PoseRun, type PoseRobotStyle, type PoseSettings } from "@/lib/canvas/pose-portrait";
import { getImageBlob, imageToDataUrl, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { buildPromptSheet, composePosePortrait, composeSinglePose, encodePoseImage, loadPoseFrame, transparentPose } from "@/services/pose-portrait-compositor";
import { requestImageCaption } from "@/services/api/image";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";

// 上游节点的图片可能只存在 metadata.content（data URL，尚未持久化），所以两种形态都要认。
export type PoseUpstream = { media: PoseMedia | null; dataUrl?: string; width: number; height: number; mimeType: string };
function rowSource(node: CanvasNodeData, row?: { storageKey?: string; content?: string; naturalWidth?: number; naturalHeight?: number; mimeType?: string }): PoseUpstream | null {
    const width = row?.naturalWidth || node.metadata?.naturalWidth || node.width, height = row?.naturalHeight || node.metadata?.naturalHeight || node.height;
    if (!(width > 0) || !(height > 0)) return null;
    const mimeType = row?.mimeType || node.metadata?.mimeType || "image/png";
    const key = row?.storageKey || node.metadata?.storageKey;
    if (key?.startsWith("image:")) return { media: { storageKey: key, width, height, mimeType }, width, height, mimeType };
    const content = row?.content || node.metadata?.content;
    if (content?.startsWith("data:image/")) return { media: null, dataUrl: content, width, height, mimeType };
    return null;
}
// 连线优先：上游图片节点若已落在本地媒体库，直接复用 storageKey；只有 data URL 时运行前再持久化。
export function upstreamSource(nodes: CanvasNodeData[]): PoseUpstream | null {
    for (const node of nodes) {
        const rows = node.metadata?.images ?? [];
        for (const row of rows) { const found = rowSource(node, row); if (found) return found; }
        const flat = rowSource(node); if (flat) return flat;
    }
    return null;
}
export function upstreamImage(nodes: CanvasNodeData[]): PoseMedia | null { return upstreamSource(nodes)?.media ?? null; }
// 第二条连线以后不再被忽略：第 1 张是真人照片，第 2 张当海报底图，边上可以继续接参考图。
export function upstreamSources(nodes: CanvasNodeData[]): PoseUpstream[] {
    const found: PoseUpstream[] = [];
    for (const node of nodes) {
        const rows = node.metadata?.images ?? [];
        for (const row of rows) { const item = rowSource(node, row); if (item) found.push(item); }
        const flat = rowSource(node); if (flat) found.push(flat);
    }
    return found;
}
// 阶段结果放成独立节点：文本可继续当提示词，图片可继续当参考图，新节点才能接着做二创。
// 连线按真实数据流接，而不是排成一条链：卡片出「动作文本」和「真人动漫化」，文本驱动角色，真人图和角色图一起进合照。
export type StageKind = "text" | "person" | "action" | "output";
export type StageState = { ids: Partial<Record<StageKind, string>>; heights: Partial<Record<StageKind, number>>; links: Set<string>; y?: number };
const STAGE_TITLE: Record<StageKind, string> = { text: "动作识别文本", person: "真人照片动漫化", action: "机械角色动漫画", output: "合成合照" };
const STAGE_ORDER: StageKind[] = ["text", "person", "action", "output"];
function stageSlots(card: Pick<CanvasNodeData, "position" | "width" | "height">) {
    const width = 300;
    // 横向铺开：一列一个阶段，跟着数据流往右走，读图顺序和连线方向一致。
    const x0 = card.position.x + card.width + 72;
    const step = width + 96;
    const top = card.position.y;
    return { width, slot: { text: { x: x0, y: top }, person: { x: x0, y: top + 204 }, action: { x: x0 + step, y: top + 40 }, output: { x: x0 + step * 2, y: top + 90 } } as Record<StageKind, { x: number; y: number }> };
}
function stageProgress(run: PoseRun, kind: StageKind) {
    const stages = (run.options?.layout === "natural" ? NATURAL_STAGES : GRID_STAGES) as string[];
    return { step: Math.max(1, stages.indexOf(kind) + 1), total: stages.length };
}
// run 的阶段名和画布节点种类不是一一对应：caption/prompt 都落在「动作识别文本」这张上。
const STAGE_NODE: Record<string, StageKind> = { caption: "text", prompt: "text", person: "person", character: "action", output: "output" };
const newStageState = (): StageState => ({ ids: {}, heights: {}, links: new Set<string>() });
// 产物要几十秒才回来，节点本身应该立刻出现：先建 4 张占位，宿主的 loading 状态会画“生成中”，
// 阶段开始时补 generationStartedAt 就有左上角计时，完成后原地 update 成真图，用户全程看得到流程。
// 连线按真实数据流接：卡片出「动作文本」和「真人动漫化」，文本驱动角色，人物图与角色图一起进合照。
export function stageLinkOps(card: Pick<CanvasNodeData, "id">, state: StageState): CanvasAgentOp[] {
    const ops: CanvasAgentOp[] = [];
    const link = (from?: string, to?: string) => {
        if (!from || !to) return;
        const key = `${from}>${to}`;
        if (state.links.has(key)) return;
        state.links.add(key);
        ops.push({ type: "connect_nodes", fromNodeId: from, toNodeId: to });
    };
    link(card.id, state.ids.text);
    link(card.id, state.ids.person);
    link(state.ids.text, state.ids.action);
    link(state.ids.person, state.ids.output);
    link(state.ids.action, state.ids.output);
    return ops;
}
// 一步一个节点：哪个阶段开始跑，才把那个节点放出来（loading + 左上角计时），完成后原地填成产物。
export function stageEnsureOps(card: Pick<CanvasNodeData, "id" | "position" | "width" | "height">, run: PoseRun, state: StageState, kind: StageKind): CanvasAgentOp[] {
    if (state.ids[kind]) return [];
    const { width, slot } = stageSlots(card);
    const id = randomId();
    state.ids[kind] = id;
    const height = kind === "text" ? 180 : 380;
    state.heights[kind] = height;
    const poseStage = { runId: run.id, stage: kind, pending: true };
    return [{
        type: "add_node", id, nodeType: kind === "text" ? "text" : "image", title: STAGE_TITLE[kind], position: slot[kind], width, height,
        metadata: kind === "text"
            ? { content: "", prompt: "", status: "loading", poseStage }
            : { status: "loading", naturalWidth: 0, naturalHeight: 0, count: 1, poseStage },
    }];
}
// 某阶段真正开始时：放节点（含该阶段的连线）并起表；“这一步跑了几秒”必须按阶段算。
export function stageStartOps(card: Pick<CanvasNodeData, "id" | "position" | "width" | "height">, run: PoseRun, state: StageState, now = Date.now()): CanvasAgentOp[] {
    const kind = STAGE_NODE[run.stage];
    if (!kind) return [];
    const created = stageEnsureOps(card, run, state, kind);
    const links = stageLinkOps(card, state);
    const id = state.ids[kind];
    const progress = stageProgress(run, kind);
    const timer: CanvasAgentOp[] = id ? [{ type: "update_node", id, metadata: { generationStartedAt: now, previewStep: progress.step, previewTotal: progress.total } }] : [];
    return [...created, ...links, ...timer];
}
// 有产物就回填：占位已存在则 update_node，手动作业（历史里“放成独立节点”）仍直接 add_node。
export function stageResultOps(card: Pick<CanvasNodeData, "id" | "position" | "width" | "height">, run: PoseRun, urls: { personArt?: string; action?: string; output?: string }, state: StageState): CanvasAgentOp[] {
    const ops: CanvasAgentOp[] = [];
    const { width, slot } = stageSlots(card);
    const place = (kind: StageKind, nodeType: "text" | "image", height: number, metadata: CanvasNodeMetadata) => {
        const existing = state.ids[kind];
        if (existing) {
            ops.push({ type: "update_node", id: existing, metadata: { ...metadata, generationStartedAt: undefined, previewStep: undefined, previewTotal: undefined } });
            return existing;
        }
        const id = randomId();
        state.ids[kind] = id; state.heights[kind] = height;
        ops.push({ type: "add_node", id, nodeType, title: STAGE_TITLE[kind], position: slot[kind], width, height, metadata });
        return id;
    };
    const picture = (kind: StageKind, media: PoseMedia | undefined, url: string | undefined, prompt?: string) => {
        if (!media || !url) return undefined;
        const height = Math.max(140, Math.min(460, Math.round((width * media.height) / media.width)));
        // 把“谁生成的、用什么模型和提示词”写进节点元数据：画布上任何一张阶段图都能追问来源。
        return place(kind, "image", height, {
            content: url, storageKey: media.storageKey, naturalWidth: media.width, naturalHeight: media.height, mimeType: media.mimeType, status: "success",
            model: run.characterModel, prompt: prompt ?? run.prompt, imageMode: "edit", count: 1,
            poseStage: { runId: run.id, stage: kind, layout: run.options.layout, style: run.robotStyle ?? "toon", pose: run.pose },
        });
    };
    if (run.pose?.trim()) place("text", "text", 180, { content: run.pose, prompt: run.pose, status: "success", poseStage: { runId: run.id, stage: "text" as const, layout: run.options.layout, style: run.robotStyle ?? "toon", pose: run.pose } });
    picture("person", run.personArt, urls.personArt, run.personPrompt);
    picture("action", run.action, urls.action, run.actionPrompt);
    picture("output", run.output, urls.output, run.prompt);
    return ops;
}
export function stageNodeOps(card: Pick<CanvasNodeData, "id" | "position" | "width" | "height">, run: PoseRun, urls: { personArt?: string; action?: string; output?: string }, state: StageState = newStageState()): CanvasAgentOp[] {
    return [...stageResultOps(card, run, urls, state), ...stageLinkOps(card, state)];
}
// 停止、报错、关页都会留下“永远转圈”的占位：统一标成失败并写清原因，比静默删除更容易看出断在哪一步。
export function interruptedStageOps(nodes: CanvasNodeData[], runId?: string): CanvasAgentOp[] {
    return nodes
        .filter(node => node.metadata?.status === "loading" && node.metadata?.poseStage?.pending && (!runId || node.metadata.poseStage.runId === runId))
        .map(node => ({
            type: "update_node" as const,
            id: node.id,
            metadata: { status: "error", errorDetails: "未生成（本轮中断或失败）", generationStartedAt: undefined, previewStep: undefined, previewTotal: undefined, poseStage: { runId: node.metadata?.poseStage?.runId, stage: node.metadata?.poseStage?.stage, pending: false } },
        }));
}
// 气泡只要一句短台词：统一清理引号、换行和模型常见的前缀。
export function tidyBubble(text: string) {
    const first = text.split(/\r?\n/).map(line => line.trim()).find(Boolean) || "";
    return first.replace(/^[「『"“']|[」』"”']$/g, "").replace(/^(气泡|台词|对白)[:：]/, "").trim().slice(0, 40);
}

// 默认直接出“真人照片｜动漫角色”左右二宫格：本地拼接，不重绘、不融合，最贴近“两张图并排”的预期。
const DEFAULTS: PoseSettings = { ...poseSettingsDefaults(), layout: "grid-horizontal", separator: "white", labels: false, frame: "none" };
// The host unmounts this panel whenever the node leaves the viewport or is resized, so an
// in-flight run must survive unmount and reattach afterwards instead of being aborted silently.
const ACTIVE_RUNS = new Map<string, AbortController>();
// The panel is unmounted and recreated on pan/resize, so "a run is active" must live outside React:
// a local setBusy(true) from the previous copy would never be cleared by the next one.
const RUN_SUBSCRIBERS = new Set<() => void>();
const STAGE_STATE = new Map<string, StageState>();
// 画布的边框进度条由宿主 canvas-node.tsx 按 metadata.stepProgress 统一渲染，插件只负责报步数。
const GRID_STAGES: PoseRun["stage"][] = ["caption", "person", "character", "output"];
const NATURAL_STAGES: PoseRun["stage"][] = ["caption", "prompt", "person", "character", "output"];
export function stepProgressOf(run?: PoseRun | null): { step: number; total: number; complete?: boolean } | null {
    if (!run) return null;
    const total = run.options?.layout === "natural" ? 5 : 4;
    if (run.status !== "running") return { step: total, total, complete: true };
    const stages = run.options?.layout === "natural" ? NATURAL_STAGES : GRID_STAGES;
    return { step: Math.min(Math.max(0, stages.indexOf(run.stage)) + 1, total), total };
}
// 宿主 canvas-node.tsx:347 只在 metadata.generationStartedAt 存在且节点“生成中”时画左上角计时徽标。
export function timerMeta(startedAt: number | undefined, finished: boolean, now = Date.now()): { generationStartedAt?: number; generationDurationMs?: number } {
    if (!startedAt) return { generationStartedAt: undefined, generationDurationMs: undefined };
    return finished ? { generationStartedAt: undefined, generationDurationMs: Math.max(0, now - startedAt) } : { generationStartedAt: startedAt, generationDurationMs: undefined };
}
const notifyRuns = () => { for (const listener of RUN_SUBSCRIBERS) listener(); };
const subscribeRuns = (listener: () => void) => { RUN_SUBSCRIBERS.add(listener); return () => { RUN_SUBSCRIBERS.delete(listener); }; };
export function mergePoseSettings(ctx: CanvasNodeContext, patch: Partial<PoseSettings>) {
    const node = ctx.getNode(ctx.node.id);
    if (!node) return;
    ctx.updateMetadata({ posePortrait: { ...DEFAULTS, ...node.metadata?.posePortrait, ...patch } });
}
function persisted(image: UploadedImage): PoseMedia {
    if (!image.storageKey || image.width <= 0 || image.height <= 0) throw new Error("图片未保存到本地媒体库，请检查存储空间与图片访问权限");
    return { storageKey: image.storageKey, width: image.width, height: image.height, mimeType: image.mimeType };
}
function Preview({ media, title }: { media?: PoseMedia; title: string }) {
    const [url, setUrl] = useState("");
    const [missing, setMissing] = useState(false);
    useEffect(() => {
        let alive = true; setUrl(""); setMissing(false);
        if (media) void resolveImageUrl(media.storageKey).then(value => { if (alive) { setUrl(value); setMissing(!value); } }).catch(() => { if (alive) setMissing(true); });
        return () => { alive = false; };
    }, [media?.storageKey]);
    return <div className="min-w-0"><div className="mb-1 text-xs text-stone-500">{title}</div>{url ? <img src={url} alt={title} className="max-h-56 w-full rounded object-contain" draggable={false} /> : <div className="rounded border border-dashed p-4 text-center text-xs text-stone-500">{missing ? "图片已缺失，请重新上传或恢复项目媒体" : media ? "正在读取图片…" : "尚无图片"}</div>}</div>;
}
function Content({ ctx }: { ctx: CanvasNodeContext }) {
    const history = ctx.node.metadata?.posePortrait?.history || [];
    const latest = history.find(run => run.output);
    return <div className="h-full p-3" onDoubleClick={() => ctx.openPanel()}><strong className="text-sm">动作迁移合照</strong><Preview media={latest?.output} title={latest ? "最近完成结果" : "上传固定角色，换真人照片后一键运行"} /></div>;
}
const buttonClass = "rounded border border-stone-300 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-stone-600";
const fieldClass = "w-full rounded border border-stone-300 bg-transparent p-1.5 text-xs dark:border-stone-600";
function Field({ title, children }: { title: string; children: ReactNode }) { return <label className="block space-y-1 text-xs"><span>{title}</span>{children}</label>; }
function Panel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const config = useEffectiveConfig();
    const ctxRef = useRef(ctx); ctxRef.current = ctx;
    const alive = useRef(false), lock = useRef(false), controller = useRef<AbortController | null>(null), startedAt = useRef(0);
    const [working, setWorking] = useState(false), [error, setError] = useState(""), [selected, setSelected] = useState<string>();
    const [notice, setNotice] = useState("");
    const [upstreamTick, setUpstreamTick] = useState(0);
    const activeRun = useSyncExternalStore(subscribeRuns, () => ACTIVE_RUNS.get(ctx.node.id) ?? null, () => null);
    // Uploads/downloads are local; a run can outlive this panel instance, so busy is derived from both.
    const busy = working || Boolean(activeRun);
    const settings = { ...DEFAULTS, ...ctx.node.metadata?.posePortrait };
    const roleOptions = poseModelOptions(config, 1), portraitOptions = poseModelOptions(config, 2);
    const defaultRole = roleOptions.find(o => o.value === ctx.ai.defaultModel("image") && !o.disabled)?.value || roleOptions.find(o => !o.disabled)?.value || "";
    const characterModel = settings.characterModel ?? defaultRole;
    const portraitModel = settings.portraitModel ?? (portraitOptions.find(o => o.value === characterModel && !o.disabled)?.value || portraitOptions.find(o => !o.disabled)?.value || "");
    const cloudId = settings.cloudApiId ?? config.promptCloudApiId ?? "";
    // Connections live in a host ref, so a wire drawn after this panel mounted is only seen on a fresh render.
    const upstream = settings.useUpstream === false ? null : upstreamSource(ctx.getUpstream?.() ?? []);
    void upstreamTick;
    const effectivePerson = upstream?.media ?? settings.person;
    // 上游第 2 张图当海报底图（第 1 张已当真人照片）。
    const upstreamPoster = settings.useUpstream === false ? undefined : upstreamSources(ctx.getUpstream?.() ?? [])[1];
    const history = settings.history || [];
    const viewing = history.find(run => run.id === selected) || history[0];
    const update = (patch: Partial<PoseSettings>) => mergePoseSettings(ctxRef.current, patch);
    // Publish one finished run as four separate canvas nodes; reused by the run and by the manual button.
    const publishStages = async (owner: CanvasNodeContext, run: PoseRun, quiet = false) => {
        try {
            const url = async (media?: PoseMedia) => (media ? (await resolveImageUrl(media.storageKey)) || media.storageKey : undefined);
            const personArt = await url(run.personArt), action = await url(run.action), output = await url(run.output);
            const state = STAGE_STATE.get(run.id) ?? { ids: {}, heights: {}, links: new Set<string>() };
            STAGE_STATE.set(run.id, state);
            const ops = stageNodeOps(owner.node, run, { personArt, action, output }, state);
            if (!ops.length) { if (alive.current && !quiet) setNotice("这些阶段节点已经在画布上了"); return; }
            owner.applyOps(ops);
            const added = ops.filter(op => op.type === "add_node").map(op => ("title" in op ? op.title : "")).filter(Boolean);
            if (alive.current && added.length) setNotice(quiet ? `已放出：${added.join("、")}` : `已生成 ${added.length} 个阶段节点，在卡片右侧（可平移画布查看）`);
        } catch (cause) {
            if (alive.current && !owner.getNode(owner.node.id)) setNotice("阶段节点未生成：节点已不存在");
            else if (alive.current && !quiet) setNotice(`阶段节点未生成：${cause instanceof Error ? cause.message : "未知错误"}`);
        }
    };
    const saveRun = (owner: CanvasNodeContext, run: PoseRun) => {
        const node = owner.getNode(owner.node.id);
        if (!node) return;
        // 进度只写 stepProgress：宿主的 CanvasNodeProgressRing 会画在节点四周，卡片内部不再摆进度条。
        const progress = stepProgressOf(run);
        if (run.status === "running") {
            const stageState = STAGE_STATE.get(run.id);
            const stageId = stageState?.ids[run.stage as StageKind];
            const target = stageId ? owner.getNode(stageId) : undefined;
            if (stageState && (!target || !target.metadata?.generationStartedAt)) owner.applyOps(stageStartOps(owner.node, run, stageState));
        }
        const started = startedAt.current || (typeof node.metadata?.generationStartedAt === "number" ? node.metadata.generationStartedAt : undefined);
        owner.updateMetadata({ ...timerMeta(started, run.status !== "running"), stepProgress: progress ?? undefined });
        if (progress?.complete) setTimeout(() => {
            const now = owner.getNode(owner.node.id);
            if (now?.metadata?.stepProgress?.complete) owner.updateMetadata({ stepProgress: undefined });
        }, 1800);
        const rows = node.metadata?.posePortrait?.history || [];
        // Pin the models that actually ran in the same metadata write as the first history row;
        // a second write would race the pending commit and lose the fields.
        const patch: Partial<PoseSettings> = { history: rows.some(row => row.id === run.id) ? rows.map(row => row.id === run.id ? run : row) : [run, ...rows] };
        if (run.characterModel) patch.characterModel = run.characterModel;
        if (run.portraitModel) patch.portraitModel = run.portraitModel;
        if (run.cloudApiId) patch.cloudApiId = run.cloudApiId;
        mergePoseSettings(owner, patch);
    };
    useEffect(() => {
        alive.current = true;
        const active = ACTIVE_RUNS.get(ctx.node.id);
        if (active) controller.current = active;
        return () => {
            alive.current = false;
            // Only uploads/downloads are cancelled here; a run keeps going and reattaches on remount.
            if (!ACTIVE_RUNS.has(ctx.node.id)) controller.current?.abort();
        };
    }, [ctx.node.id]);
    // Interrupted sessions cannot resume their request promises after reload. Keep partial results, mark honestly.
    useEffect(() => {
        if (!ACTIVE_RUNS.has(ctxRef.current.node.id) && ctxRef.current.getNode(ctxRef.current.node.id)?.metadata?.stepProgress) ctxRef.current.updateMetadata({ stepProgress: undefined });
        // 关页、崩溃或刷新后没有回调可跑，占位节点只能在这里收口。
        if (!ACTIVE_RUNS.has(ctxRef.current.node.id)) {
            const orphans = interruptedStageOps(ctxRef.current.getNodes());
            if (orphans.length) ctxRef.current.applyOps(orphans);
        }
        if (ACTIVE_RUNS.has(ctxRef.current.node.id)) return;
        const rows = ctxRef.current.getNode(ctxRef.current.node.id)?.metadata?.posePortrait?.history;
        if (rows?.some(row => row.status === "running")) update({ history: rows.map(row => row.status === "running" ? { ...row, status: "stopped", error: "页面或面板已关闭，已停止后续步骤；后台 GPU 任务可能仍在运行" } : row) });
    }, [ctx.node.id]);
    const begin = () => {
        if (lock.current || !alive.current) return null;
        lock.current = true; setWorking(true); setError("");
        const next = new AbortController(); controller.current = next; return next;
    };
    const finish = (current: AbortController) => {
        if (controller.current !== current) return;
        lock.current = false; controller.current = null; if (alive.current) setWorking(false);
    };
    const check = (signal: AbortSignal) => assertPoseActive(signal, alive.current && Boolean(ctxRef.current.getNode(ctxRef.current.node.id)));
    async function upload(event: ChangeEvent<HTMLInputElement>, key: "person" | "character") {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        const current = begin(); if (!current) return;
        // Pin the node that started the upload: the panel instance can be reused for another node mid-flight.
        const owner = ctxRef.current;
        const stillOwned = () => alive.current && Boolean(owner.getNode(owner.node.id));
        let auto = false;
        try {
            if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) throw new Error("请选择不超过 20MB 的图片");
            const image = await uploadImage(file, { signal: current.signal });
            assertPoseActive(current.signal, stillOwned());
            mergePoseSettings(owner, { [key]: persisted(image) });
            // One click: a fresh person photo starts the whole run as soon as a fixed role image exists.
            auto = key === "person" && settings.autoRun !== false && Boolean(owner.getNode(owner.node.id)?.metadata?.posePortrait?.character);
        } catch { if (alive.current && !current.signal.aborted) setError("上传失败：请选择不超过 20MB、可解码的图片，并确认本地存储可用。"); }
        finally { finish(current); }
        if (auto) void run();
    }
    async function uploadFrame(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        const current = begin(); if (!current) return;
        const owner = ctxRef.current;
        try {
            if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) throw new Error("请选择不超过 20MB 的图片");
            const image = await uploadImage(file, { signal: current.signal });
            assertPoseActive(current.signal, alive.current && Boolean(owner.getNode(owner.node.id)));
            mergePoseSettings(owner, { frameMedia: persisted(image) });
        } catch { if (alive.current && !current.signal.aborted) setError("海报底图上传失败：请选择不超过 20MB、可解码的图片。"); }
        finally { finish(current); }
    }
    async function run() {
        if (ACTIVE_RUNS.has(ctxRef.current.node.id)) { if (alive.current) setNotice("已有一轮在运行，请等它结束或先停止"); return; }
        const current = begin(); if (!current) return;
        const owner = ctxRef.current, nodeId = owner.node.id;
        ACTIVE_RUNS.set(nodeId, current); notifyRuns();
        startedAt.current = Date.now();
        owner.updateMetadata({ generationStartedAt: startedAt.current, generationDurationMs: undefined });
        let startedRun: PoseRun | undefined;
        const runActive = () => ACTIVE_RUNS.get(nodeId) === current && Boolean(owner.getNode(nodeId));
        const runCheck = (signal: AbortSignal) => assertPoseActive(signal, runActive());
        try {
            const snapshot: PoseSettings = structuredClone({ ...DEFAULTS, ...owner.getNode(owner.node.id)?.metadata?.posePortrait, characterModel, portraitModel });
            // Re-read the graph here: the panel can render before the user drags the wire.
            const live = snapshot.useUpstream === false ? null : upstreamSource(owner.getUpstream?.() ?? []);
            if (live?.dataUrl) snapshot.person = persisted(await uploadImage(live.dataUrl, { signal: current.signal }));
            else if (live?.media) snapshot.person = live.media;
            runCheck(current.signal);
            if (!snapshot.person || !snapshot.character) throw new Error(!snapshot.character ? "请先上传固定机械角色" : live ? "上游连线里没有可用的图片，请重新连一张图片节点或直接上传真人照片" : "请先上传真人照片与固定机械角色，或把图片节点连到卡片左侧");
            const resolved = resolvePoseConfig(config, snapshot);
            // Verify both inputs exist before submitting any model task.
            const personBlob = await getImageBlob(snapshot.person.storageKey); runCheck(current.signal);
            const characterBlob = await getImageBlob(snapshot.character.storageKey); runCheck(current.signal);
            if (!personBlob || !characterBlob) throw new Error("输入图片已缺失，请重新上传");
            const runData: PoseRun = { id: randomId(), time: new Date().toISOString(), options: { layout: snapshot.layout, separator: snapshot.separator, labels: snapshot.labels, ...(snapshot.bubble?.trim() && !snapshot.bubbleAuto ? { bubble: snapshot.bubble.trim().slice(0, 40) } : {}), ...(snapshot.bubbleAuto ? { bubbleAuto: true } : {}), promptMode: snapshot.promptMode ?? "model", style: snapshot.robotStyle ?? "toon", frame: snapshot.frame ?? "none", frameSource: snapshot.frameSource ?? "builtin", frameSize: snapshot.frameSize ?? "medium", output: snapshot.output ?? "single" }, person: snapshot.person, character: snapshot.character, characterModel: resolved.characterModel, characterInputs: poseModelInputs(config, resolved.characterModel), portraitModel: resolved.portraitModel, robotStyle: snapshot.robotStyle ?? "toon", engine: snapshot.engine || "qwen35", cloudApiId: resolved.cloudApiId, cloudModel: resolved.cloud?.model, status: "running", stage: "caption" };
            // The endpoint throws for an empty result instead of returning ""; that empty case is actionable, not a transport failure.
            const captionText = async (params: Parameters<typeof requestImageCaption>[1], signal: AbortSignal) => {
                try {
                    const result = await requestImageCaption(resolved.captionConfig, params, { signal });
                    runCheck(signal); return result.prompt;
                } catch (cause) {
                    if (cause instanceof Error && cause.message === i18n.t("apiErrors.promptOptimizeEmpty")) return "";
                    throw cause;
                }
            };
            setSelected(runData.id);
            // 先把整条流水线画出来，再让每一步在里面变“进行中/完成”，而不是等产物回来才凭空冒节点。
            startedRun = runData;
            const stageState = STAGE_STATE.get(runData.id) ?? newStageState();
            STAGE_STATE.set(runData.id, stageState);
            const data = async (media: PoseMedia, signal: AbortSignal) => {
                runCheck(signal); const value = await imageToDataUrl(media, { signal }); runCheck(signal);
                if (!value) throw new Error("图片缺失"); return value;
            };
            const store = async (value: string | Blob, signal: AbortSignal) => {
                runCheck(signal); const image = await uploadImage(value, { signal }); runCheck(signal); return persisted(image);
            };
            // 海报底图三种来源：内置峰会海报 / 面板上传 / 上游连线第 2 张图。一套加载器，二宫格与单张共用。
            const frameLoaderFor = async (options: PoseOptions) => {
                if (options.frameSource === "upload") {
                    const key = snapshot.frameMedia?.storageKey;
                    if (!key) throw new Error("还没有上传海报底图，请在面板里选一张图片");
                    const blob = await getImageBlob(key); if (!blob) throw new Error("海报底图已丢失，请重新上传"); return blob;
                }
                if (options.frameSource === "upstream") {
                    const poster = upstreamSources(owner.getUpstream?.() ?? [])[1];
                    if (!poster) throw new Error("上游没有海报图：把海报图片节点连到卡片上（按连线顺序第 2 张）");
                    if (poster.media) { const blob = await getImageBlob(poster.media.storageKey); if (!blob) throw new Error("海报图已丢失，请重新连接"); return blob; }
                    if (poster.dataUrl) return await (await fetch(poster.dataUrl)).blob();
                    throw new Error("海报图不可用，请重新连接图片节点");
                }
                return loadPoseFrame();
            };
            await runPosePortrait(runData, {
                isActive: runActive,
                save: value => saveRun(owner, value),
                caption: async signal => {
                    const dataUrl = await data(runData.person, signal); runCheck(signal);
                    return captionText({ images: [{ id: runData.id, name: "person", type: runData.person.mimeType, storageKey: runData.person.storageKey, dataUrl }], language: "zh", instruction: POSE_INSTRUCTION, engine: runData.engine, cloud: resolved.cloud }, signal);
                },
                generate: async (prompt, model, refs, signal) => {
                    const references: string[] = [];
                    for (const ref of refs) { references.push(await data(ref, signal)); runCheck(signal); }
                    // 本地网关按 mode 决定是否走图像编辑；缺失时发布会退化为文生图并丢掉参考角色设计。
                    const result = await owner.ai.generateImage(prompt, poseImageRequest(model, references, signal)); runCheck(signal);
                    if (!result.images[0]) throw new Error("生成未返回图片"); return store(result.images[0], signal);
                },
                describe: async signal => {
                    // 反推端点只接受一张图，因此把机械角色与真人动作拼成左右两栏，一次读取两种参考。
                    const sheet = await buildPromptSheet(characterBlob, personBlob, signal); runCheck(signal);
                    const dataUrl = await data(await store(sheet, signal), signal);
                    return captionText({ images: [{ id: runData.id, name: "sheet", type: "image/jpeg", storageKey: "", dataUrl }], language: "zh", instruction: promptSheetInstruction(runData.robotStyle ?? "anime2d"), engine: runData.engine, cloud: resolved.cloud }, signal);
                },
                describeArt: async (kind, signal) => {
                    // 人物和角色各给一张自己的参考图，让模型只写给这一张用的提示词；失败会退回固定模板。
                    const media = await store(kind === "person" ? personBlob : characterBlob, signal);
                    const dataUrl = await data(media, signal);
                    return captionText({ images: [{ id: runData.id, name: kind, type: media.mimeType, storageKey: media.storageKey, dataUrl }], language: "zh", instruction: kind === "person" ? PERSON_ART_INSTRUCTION : ROBOT_ART_INSTRUCTION, engine: runData.engine, cloud: resolved.cloud }, signal);
                },
                bubble: async (pose, signal) => {
                    // The caption endpoint only describes images, and an unconfigured text model would pop the settings dialog.
                    const textModel = owner.ai.defaultModel("text");
                    if (!textModel) return "";
                    const result = await owner.ai.generateText("照片中人物的动作与状态：" + pose, { model: textModel, signal, system: BUBBLE_INSTRUCTION });
                    runCheck(signal); return tidyBubble(result.text || "");
                },
                progress: async (partial) => { if (snapshot.exportStages !== false && ACTIVE_RUNS.get(nodeId) === current) await publishStages(owner, partial, true); },
                // 动漫画风出的是绿幕图：存盘前先抠成透明 PNG 并补速度线，导出的单张图才是真透明背景。
                alpha: async (media, style, signal) => {
                    const blob = await getImageBlob(media.storageKey); runCheck(signal);
                    if (!blob) throw new Error("本地图片已缺失");
                    const flat = await transparentPose(blob, style, signal); runCheck(signal);
                    const saved = await uploadImage(flat, { signal }); runCheck(signal);
                    if (!saved.storageKey?.startsWith("image:")) throw new Error("透明背景处理失败，请重试");
                    return persisted(saved);
                },
            compose: async (person, action, options, signal) => {
                    const first = await getImageBlob(person.storageKey); runCheck(signal);
                    const second = await getImageBlob(action.storageKey); runCheck(signal);
                    if (!first || !second) throw new Error("本地图片已缺失");
                    // 海报底图三种来源：内置峰会海报 / 面板上传 / 上游连线第 2 张图。
                    const frameLoader = () => frameLoaderFor(options);
                    const result = await composePosePortrait(first, second, options, signal, "image/png", frameLoader); runCheck(signal); return store(result, signal);
                },
                // 单张输出也能装到海报上：同一套安全区与白卡纸，只是内容换成这张动漫图。
                composeSingle: async (media, options, signal) => {
                    const blob = await getImageBlob(media.storageKey); runCheck(signal);
                    if (!blob) throw new Error("本地图片已缺失");
                    const result = await composeSinglePose(blob, options, signal, "image/png", () => frameLoaderFor(options)); runCheck(signal);
                    return store(result, signal);
                },
            }, current.signal);
            // Each stage also becomes a real canvas node, so the result can feed further edits instead of being a dead-end image.
            if (runData.status !== "done") { if (alive.current) setNotice("本轮没有正常跑完，未导出阶段节点；可在历史里重新运行"); }
            else if (snapshot.exportStages !== false) await publishStages(owner, runData, true);
        } catch (cause) {
            // 已经放出去的占位节点要收口，否则会永远显示“生成中”。
            if (startedRun) owner.applyOps(interruptedStageOps(owner.getNodes(), startedRun.id));
            // Only local preflight errors are surfaced verbatim. Network errors are handled by runner with fixed safe text.
            if (alive.current) setError(current.signal.aborted ? "已停止后续步骤；后台 GPU 任务可能仍在运行" : cause instanceof Error && !/https?:|data:|blob:|api.?key/i.test(cause.message) ? cause.message : "启动失败，请检查输入、模型和存储配置");
        } finally { if (ACTIVE_RUNS.get(nodeId) === current) { ACTIVE_RUNS.delete(nodeId); notifyRuns(); }
            // 页面被挂起、标签关闭或中断时不会跑到定时清理，这里兜底：只要没标完成就把边框进度收回。
            const now = owner.getNode(owner.node.id);
            const leftover = now?.metadata?.stepProgress;
            const started = startedAt.current || (typeof now?.metadata?.generationStartedAt === "number" ? now.metadata.generationStartedAt : undefined);
            if (now?.metadata?.generationStartedAt || (leftover && !leftover.complete)) owner.updateMetadata({ ...timerMeta(started, true), stepProgress: undefined });
            startedAt.current = 0;
            finish(current); }
    }
    async function download(media: PoseMedia, mimeType: "image/png" | "image/jpeg") {
        const current = begin(); if (!current) return;
        try {
            const blob = await getImageBlob(media.storageKey); check(current.signal); if (!blob) throw new Error("图片缺失");
            const output = await encodePoseImage(blob, current.signal, mimeType); check(current.signal);
            saveAs(output, `pose-portrait-${viewing?.id || "output"}.${mimeType === "image/png" ? "png" : "jpg"}`);
        } catch { if (alive.current) setError("下载失败：图片缺失或无法转码，请恢复项目媒体后重试"); }
        finally { finish(current); }
    }
    const selectModel = (title: string, value: string, options: ReturnType<typeof poseModelOptions>, key: "characterModel" | "portraitModel") => <Field title={title}><select aria-label={title} className={fieldClass} value={value} onChange={e => update({ [key]: e.target.value })}><option value="">请选择模型</option>{value && !options.some(o => o.value === value) && <option value={value}>已失效：{value}</option>}{options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</select></Field>;
    const surface = ctx.theme?.toolbar;
    return <div className="thin-scrollbar max-h-[72vh] w-[520px] max-w-[90vw] space-y-3 overflow-y-auto rounded-2xl border p-4 text-stone-800 shadow-[0_18px_50px_rgba(28,25,23,.18)] dark:text-stone-100" style={{ background: surface?.panel ?? "var(--panel, #fff)", borderColor: surface?.border ?? "rgba(120,113,108,.25)" }} data-canvas-no-zoom onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><strong>动作迁移合照</strong><button className={buttonClass} onClick={() => { controller.current?.abort(); onClose(); }}>关闭</button></div>
        <p className="text-xs text-stone-500">固定机械角色，只换真人照片，一键完成动作识别、提示词、角色与合照。请保持页面打开。</p>
        <fieldset disabled={busy} className="grid grid-cols-2 gap-3 disabled:opacity-60">
            <div className="col-span-2 grid grid-cols-2 gap-3"><div><Preview media={effectivePerson} title="真人照片" />{upstream ? <p className="mt-1 text-[11px] text-emerald-600">已使用上游连线图片{upstream.dataUrl ? "（运行开始时保存到本地媒体）" : ""}</p> : <><input aria-label="真人照片" className="mt-2 w-full text-xs" type="file" accept="image/*" onChange={e => void upload(e, 'person')} /><button type="button" className="mt-1 text-[11px] text-stone-500 underline" onClick={() => setUpstreamTick(tick => tick + 1)}>重新读取上游连线</button></>}</div>
                <div><Preview media={settings.character} title="固定机械角色" /><input aria-label="固定机械角色" className="mt-2 w-full text-xs" type="file" accept="image/*" onChange={e => void upload(e, 'character')} /></div></div>
            <div className="min-w-0"><Field title="动作识别引擎"><select className={fieldClass} aria-label="动作识别引擎" value={settings.engine} onChange={e => update({ engine: e.target.value as "qwen35" | "cloud" })}><option value="qwen35">本地 Qwen3.5</option><option value="cloud">云端反推（经本地网关）</option></select></Field></div>
            <div className="min-w-0"><Field title="动漫画风（人物＋机械角色）"><select className={fieldClass} aria-label="机械角色画风" value={settings.robotStyle || "toon"} onChange={e => update({ robotStyle: e.target.value as "anime2d" | "realistic" | "manga" | "toon" })}><option value="toon">简约卡通分格（白底黑框、星星装饰）</option><option value="anime2d">日系2D卡通（透明背景、含集中线网点）</option><option value="manga">黑白漫画（透明背景）</option><option value="realistic">实拍写实（人物保留照片）</option></select></Field></div>
            <div className="min-w-0"><Field title="提示词来源"><select className={fieldClass} aria-label="提示词来源" value={settings.promptMode || "model"} onChange={e => update({ promptMode: e.target.value as "model" | "template" })}><option value="model">模型看图各写一段（更贴合本张照片）</option><option value="template">固定模板（更稳定、更快）</option></select></Field></div>
            {<label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.autoRun !== false} onChange={e => update({ autoRun: e.target.checked })} />上传真人照片后自动开始（一键生成）</label>}
            {<label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.exportStages !== false} onChange={e => update({ exportStages: e.target.checked })} />运行后把动作文本、两张动漫画、合照放成独立节点（继续二创用）</label>}
            {settings.engine === "cloud" && <div className="col-span-2"><Field title="云端反推配置"><select aria-label="云端反推配置" className={fieldClass} value={cloudId} onChange={e => update({ cloudApiId: e.target.value })}><option value="">使用现有默认／旧版云端配置</option>{cloudId && !(config.promptCloudApis || []).some(a => a.id === cloudId) && <option value={cloudId}>已失效：{cloudId}</option>}{(config.promptCloudApis || []).map(api => <option key={api.id} value={api.id}>{api.name} · {api.model}</option>)}</select><span className="text-stone-500">缺少配置时请到现有设置添加；这里不保存凭据。</span></Field></div>}
            {selectModel("角色生成模型（至少一张参考图）", characterModel, roleOptions, "characterModel")}
            <Field title="最终输出模式"><select className={fieldClass} aria-label="最终输出模式" value={settings.layout} onChange={e => update({ layout: e.target.value as PoseOptions["layout"] })}><option value="horizontal">二宫格·左右（真人｜动漫角色）</option><option value="vertical">二宫格·上下（真人｜动漫角色）</option><option value="grid-horizontal">二宫格·左右·等比方格</option><option value="grid-vertical">二宫格·上下·等比方格</option><option value="natural">自然合照（模型重绘，会融合）</option></select></Field>
            {<div className="col-span-2"><Field title="对白气泡文字（留空不加）"><input className={fieldClass} value={settings.bubble ?? ""} maxLength={12} placeholder={settings.bubbleAuto ? "由模型根据照片自动写" : "例如：点赞！"} disabled={settings.bubbleAuto} onChange={e => update({ bubble: e.target.value || undefined })} /><label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.bubbleAuto === true} onChange={e => update({ bubbleAuto: e.target.checked })} />让模型按动作自动写气泡台词</label></Field></div>}
            {settings.layout === "natural" ? selectModel("合照生成模型（至少两张参考图）", portraitModel, portraitOptions, "portraitModel") : <div className="col-span-2 grid grid-cols-2 gap-3"><Field title="分隔样式"><select className={fieldClass} value={settings.separator} onChange={e => update({ separator: e.target.value as PoseOptions["separator"] })}><option value="none">无间距</option><option value="white">白色间距</option><option value="black">黑色分隔线</option></select></Field><label className="self-center text-xs"><input type="checkbox" checked={settings.labels} onChange={e => update({ labels: e.target.checked })} /> 显示真人／机械角色标签</label></div>}
            {<div className="col-span-2 grid grid-cols-2 gap-3"><Field title="输出形态"><select className={fieldClass} aria-label="输出形态" value={settings.output ?? "single"} onChange={e => update({ output: e.target.value as "single" | "grid" })}><option value="single">单张动漫图（二张各自独立，不拼图）</option><option value="grid">二宫格（本地拼接）</option></select></Field><Field title="画布背景"><select className={fieldClass} aria-label="输出画布" value={settings.frame ?? "none"} onChange={e => update({ frame: e.target.value as "none" | "openeuler" })}><option value="none">透明背景（无海报）</option><option value="openeuler">海报背景（原图复用＋相框）</option></select></Field></div>}
            {settings.frame === "openeuler" && <div className="col-span-2 space-y-2 rounded-lg border border-dashed p-2"><Field title="海报来源"><select className={fieldClass} aria-label="海报来源" value={settings.frameSource ?? "builtin"} onChange={e => update({ frameSource: e.target.value as "builtin" | "upload" | "upstream" })}><option value="builtin">内置：OpenEuler 峰会海报</option><option value="upload">自己上传一张底图</option><option value="upstream">用上游连线里的第 2 张图</option></select></Field>
                <Field title="画面大小"><select className={fieldClass} aria-label="画面大小" value={settings.frameSize ?? "medium"} onChange={e => update({ frameSize: e.target.value as "small" | "medium" | "large" })}><option value="small">小（约占 62% 高）</option><option value="medium">中（约占 78% 高）</option><option value="large">大（约占 90% 高）</option></select></Field>
                {settings.frameSource === "upload" && <div><Preview media={settings.frameMedia} title="海报底图" /><input aria-label="海报底图" className="mt-2 w-full text-xs" type="file" accept="image/*" onChange={e => void uploadFrame(e)} /></div>}
                {settings.frameSource === "upstream" && <p className={upstreamPoster ? "text-[11px] text-emerald-600" : "text-[11px] text-amber-600"}>{upstreamPoster ? "已接入上游第 2 张图当海报" : "把海报图片节点连到本卡片；按连线顺序第 2 张图当海报"}</p>}
                <p className="text-[11px] opacity-60">海报只当背景复用，原图不会重绘；透明背景只对单张图有意义，海报模式会铺满画布。</p></div>}
        </fieldset>
        <p className="text-xs text-stone-500">{settings.layout === "natural" ? "自然合照会重新生成画面，不能保证人脸、角色与手势完全一致。" : "本地布局不调用最终合照模型；完整等比显示、不裁切，缩放会重采样，JPG 有损。"}</p>
        <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => void run()}>{busy ? "处理中…" : "一键生成"}</button><button className={buttonClass} disabled={!busy} onClick={() => controller.current?.abort()}>停止后续步骤</button></div>
        <p className="text-xs text-amber-600">运行中可平移画布，面板会自动接回进度；点“停止后续步骤”或关闭面板才中止前端请求，不能保证后台 GPU 任务已取消。失败不自动重试。</p>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {notice && !error && <p role="status" className="text-xs text-emerald-600">{notice}</p>}
        {viewing && <section className="space-y-2 border-t pt-3">
            <Field title="历史结果"><select className={fieldClass} value={viewing.id} onChange={e => setSelected(e.target.value)}>{history.map(row => <option key={row.id} value={row.id}>{new Date(row.time).toLocaleString()} · {({ running: "运行中", done: "完成", error: "失败", stopped: "已停止" })[row.status]}</option>)}</select></Field>
            <ol className="flex flex-wrap gap-3 text-xs">{([['caption', '动作识别', viewing.pose], ...(viewing.options.layout === "natural" ? [['prompt', '提示词生成', viewing.prompt] as const] : []), ['person', '人物动漫化', viewing.personArt], ['character', '角色生成', viewing.action], ['output', '最终输出', viewing.output]] as const).map(([stage, title, value], index) => <li key={stage}>{index + 1}. {title}：{value ? '完成' : viewing.status === 'running' && viewing.stage === stage ? '进行中' : viewing.status !== 'running' && viewing.stage === stage ? '未完成' : '未执行'}</li>)}</ol>
            <p className="break-all text-xs text-stone-500">反推：{viewing.engine === "cloud" ? viewing.cloudModel : "本地 Qwen3.5"}；画风：{viewing.robotStyle === "realistic" ? "实拍写实" : viewing.robotStyle === "manga" ? "黑白漫画" : "日系2D"}；角色：{viewing.characterModel}；最终：{viewing.portraitModel || viewing.options.layout}</p>
            {viewing.error && <p role="alert" className="text-xs text-red-600">{viewing.error}</p>}
            {viewing.pose && <details open><summary className="text-xs">本轮动作文本</summary><p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{viewing.pose}</p></details>}
            {viewing.prompt && <details><summary className="text-xs">本轮生成提示词</summary><p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{viewing.prompt}</p></details>}
            <div className="grid grid-cols-2 gap-3"><Preview media={viewing.person} title="本轮真人原图" /><Preview media={viewing.action} title="本轮动作角色图" /></div>
            <Preview media={viewing.output} title="最终结果" />
            {viewing.output && <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => void download(viewing.output!, "image/png")}>下载 PNG</button><button className={buttonClass} disabled={busy} onClick={() => void download(viewing.output!, "image/jpeg")}>下载 JPG</button><button className={buttonClass} disabled={busy} onClick={() => void publishStages(ctxRef.current, viewing)}>放成独立节点</button></div>}
        </section>}
    </div>;
}
export const posePortraitDefinition: CanvasNodeDefinition = {
    type: "builtin:pose-portrait", title: "动作迁移合照", icon: <Users className="size-4" />,
    description: "换真人照片，一键识别动作、生成提示词与日系2D角色，再合成自然合照或本地布局",
    defaultSize: { width: 340, height: 260 }, defaultMetadata: { posePortrait: { ...DEFAULTS } },
    showInCreateMenu: true, autoOpenPanel: true, hasSourceHandle: true, Content, Panel,
};
