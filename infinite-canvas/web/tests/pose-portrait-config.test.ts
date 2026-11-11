import { expect, test } from "bun:test";
import { resolvePoseConfig, poseModelOptions } from "../src/lib/canvas/pose-portrait-config";
import type { AiConfig } from "../src/stores/use-config-store";
import type { PoseSettings } from "../src/lib/canvas/pose-portrait";
const config = () => ({ channels: [
    { id: "remote", name: "Remote", baseUrl: "https://example.invalid", apiKey: "runtime-only", apiFormat: "openai", models: [{ name: "one", capability: "image", imageInputs: 1 }, { name: "two", capability: "image", imageInputs: 2 }, { name: "unknown", capability: "image" }] },
    { id: "local-gateway", name: "Local", baseUrl: "http://127.0.0.1:8190/v1", apiKey: "", apiFormat: "openai", models: [{ name: "image-qwen21", capability: "image", imageInputs: 4 }] },
], model: "remote::one", imageModel: "remote::one", promptCloudApis: [{ id: "vision", name: "Vision", baseUrl: "https://example.invalid", apiKey: "runtime-only", model: "visual" }], promptCloudApiId: "vision" }) as AiConfig;
const settings = (): PoseSettings => ({ layout: "natural", separator: "none", labels: false, characterModel: "remote::one", portraitModel: "remote::two", engine: "cloud", cloudApiId: "vision" });
test("independent image models and cloud caption always use local gateway; no global mutation", () => {
    const c = config(), before = JSON.stringify(c), r = resolvePoseConfig(c, settings());
    expect(r.captionConfig.model).toBe("local-gateway::image-qwen21"); expect(r.characterModel).toBe("remote::one"); expect(r.portraitModel).toBe("remote::two");
    expect(r.cloud?.model).toBe("visual"); expect(JSON.stringify(c)).toBe(before);
});
test("removed selections and unknown capacity are rejected", () => {
    for (const patch of [{ characterModel: "missing::one" }, { portraitModel: "remote::one" }, { characterModel: "remote::unknown" }, { cloudApiId: "deleted" }]) expect(() => resolvePoseConfig(config(), { ...settings(), ...patch })).toThrow();
});
test("layouts ignore portrait model and qwen needs no cloud; legacy cloud is supported", () => {
    expect(resolvePoseConfig(config(), { ...settings(), layout: "horizontal", portraitModel: "deleted", engine: "qwen35" }).portraitModel).toBeUndefined();
    const c = config(); c.promptCloudApis = []; c.promptCloudBaseUrl = "https://legacy.invalid"; c.promptCloudApiKey = "runtime-only"; c.promptCloudModel = "legacy";
    expect(resolvePoseConfig(c, { ...settings(), cloudApiId: undefined }).cloud?.model).toBe("legacy");
});
test("caption gateway cannot silently use an unrelated loopback service", () => {
    const c = config(); c.channels = [ { ...c.channels[0], baseUrl: "http://127.0.0.1:9999/v1" } ];
    expect(() => resolvePoseConfig(c, settings())).toThrow("本地网关");
});
test("caption route supports cleared gateway models and exact-origin fallback", () => {
    const c = config(); c.channels[1].models = [];
    expect(resolvePoseConfig(c, settings()).captionConfig.model).toBe("local-gateway::caption");
    c.channels[1].id = "gateway-alias";
    c.channels.unshift({ ...c.channels[0], id: "unrelated", baseUrl: "http://127.0.0.1:9999/v1" });
    expect(resolvePoseConfig(c, settings()).captionConfig.model).toBe("gateway-alias::caption");
});
test("model options explain unsupported references", () => {
    const options = poseModelOptions(config(), 2); expect(options.find(o => o.value === "remote::one")?.disabled).toBe(true);
    expect(options.find(o => o.value === "remote::two")?.disabled).toBe(false);
});
