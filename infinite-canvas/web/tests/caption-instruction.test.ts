import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Execute the real callback, without importing the browser-only component graph.
// Only image resolution, network I/O and component state boundaries are stubbed.
const source = readFileSync(new URL("../src/components/canvas/canvas-node-prompt-panel.tsx", import.meta.url), "utf8");
const start = source.indexOf("    const captionPrompt = async () => {");
const end = source.indexOf("\n    const stopCaption =", start);
if (start < 0 || end < 0) throw new Error("Cannot locate captionPrompt");
const createCaption = new Function("deps", `
    const { captionEngine, canCaption, draftRef, node, nodes, imageReferences,
        config, registerCaptionJob, onConfigChange, resolveCanvasReferenceImages,
        requestImageCaption, clearCaptionPreview, releaseCaptionJob, t } = deps;
    ${source.slice(start, end)}
    return captionPrompt;
`);

type State = { captionStatus?: string; captionError?: string; captionPrompt?: string };
type Params = { images: unknown; language: string; engine: string; instruction?: string; cloud?: unknown };
type Request = [unknown, Params, { signal: AbortSignal }];
type Options = { engine?: string | null; canCaption?: boolean; duringResolve?: string; noImage?: boolean; fail?: boolean; abort?: boolean };

async function run(draft: string, options: Options = {}) {
    const requests: Request[] = [];
    const states: State[] = [];
    const registered: [string, AbortController][] = [];
    const released: [string, AbortController][] = [];
    const draftRef = { current: "stale rendered prompt" };
    const images = [{ dataUrl: "data:image/png;base64,test" }];
    const config = { promptCloudBaseUrl: " https://example.invalid ", promptCloudApiKey: " test-only ", promptCloudModel: " vision " };
    let cleared = 0;
    const engine = options.engine === undefined ? "qwen35" : options.engine;
    const caption = createCaption({
        captionEngine: engine, canCaption: options.canCaption ?? true, draftRef,
        node: { id: "caption-node" }, nodes: [], imageReferences: ["first", "second"], config,
        registerCaptionJob: (id: string, controller: AbortController) => registered.push([id, controller]),
        onConfigChange: (_id: string, state: State) => states.push(state),
        resolveCanvasReferenceImages: async (refs: string[]) => {
            expect(refs).toEqual(["first"]);
            if (options.duringResolve !== undefined) draftRef.current = options.duringResolve;
            return options.noImage ? [] : images;
        },
        requestImageCaption: async (...args: Request) => {
            requests.push(args);
            if (options.abort) registered[0][1].abort();
            if (options.fail || options.abort) throw new Error("caption network failed");
            return { prompt: "caption result", engine };
        },
        clearCaptionPreview: () => { cleared += 1; },
        releaseCaptionJob: (id: string, controller: AbortController) => released.push([id, controller]),
        t: (key: string) => key,
    }) as () => Promise<void>;
    draftRef.current = draft;
    await caption();
    return { requests, states, registered, released, images, config, cleared };
}

for (const engine of ["cloud", "qwen35", "florence"]) {
    test(`${engine} forwards the trimmed latest draft without changing other parameters`, async () => {
        const result = await run("  只描述服装，不描述背景。\n", { engine });
        expect(result.requests).toHaveLength(1);
        const [config, params, options] = result.requests[0];
        expect(config).toBe(result.config);
        expect(params.images).toBe(result.images);
        expect(params.language).toBe("zh");
        expect(params.engine).toBe(engine);
        expect(params.instruction).toBe("只描述服装，不描述背景。");
        expect(params.cloud).toEqual(engine === "cloud" ? {
            baseUrl: "https://example.invalid", apiKey: "test-only", model: "vision",
        } : undefined);
        expect(options.signal).toBe(result.registered[0][1].signal);
        expect(options.signal.aborted).toBe(false);
        expect(result.released).toEqual(result.registered);
        expect(result.states.map((state) => state.captionStatus)).toEqual(["running", "done"]);
        expect(result.states[1].captionPrompt).toBe("caption result");
    });
}

test("captures instruction at click time before asynchronous image resolution", async () => {
    const result = await run("点击时的要求", { duringResolve: "后来编辑的要求" });
    expect(result.requests[0][1].instruction).toBe("点击时的要求");
});

for (const blank of ["", " \n\t "]) {
    test(`blank ${JSON.stringify(blank)} keeps default caption behavior`, async () => {
        const result = await run(blank);
        expect(result.requests[0][1].instruction).toBeUndefined();
    });
}

for (const options of [{ engine: null }, { canCaption: false }]) {
    test(`guard ${JSON.stringify(options)} starts no job or request`, async () => {
        const result = await run("instruction", options);
        expect(result.requests).toHaveLength(0);
        expect(result.registered).toHaveLength(0);
        expect(result.released).toHaveLength(0);
        expect(result.states).toHaveLength(0);
    });
}

test("missing image reports an error and releases the job without a request", async () => {
    const result = await run("instruction", { noImage: true });
    expect(result.requests).toHaveLength(0);
    expect(result.states[1]).toEqual({ captionStatus: "error", captionError: "canvas.promptPanel.captionNoImage" });
    expect(result.released).toEqual(result.registered);
});

test("network failure reports its message and releases the job", async () => {
    const result = await run("instruction", { fail: true });
    expect(result.states[1]).toEqual({ captionStatus: "error", captionError: "caption network failed" });
    expect(result.released).toEqual(result.registered);
});

test("cancellation clears preview instead of reporting a network error", async () => {
    const result = await run("instruction", { abort: true });
    expect(result.cleared).toBe(1);
    expect(result.states.map((state) => state.captionStatus)).toEqual(["running"]);
    expect(result.released).toEqual(result.registered);
});

test("the verified release layout keeps the floating AgentPet mounted", () => {
    const layout = readFileSync(new URL("../src/layouts/user-layout.tsx", import.meta.url), "utf8");
    const pet = readFileSync(new URL("../src/components/agent/agent-pet.tsx", import.meta.url), "utf8");
    expect(layout).toContain('import { AgentPet } from "@/components/agent/agent-pet"');
    expect(layout).toContain("<AgentPet />");
    expect(pet).toContain("canvas-agent-pet-position");
    expect(pet).toContain("AgentCloudChat");
});
