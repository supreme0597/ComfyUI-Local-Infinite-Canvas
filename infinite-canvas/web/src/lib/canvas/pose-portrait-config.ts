import { isLocalGatewayUrl, LOCAL_GATEWAY_BASE_URL } from "@/constant/app-mode";
import type { AiConfig } from "@/stores/use-config-store";
import type { PoseSettings } from "./pose-portrait";

export function poseModelOptions(config: AiConfig, references: number) {
    return config.channels.flatMap(channel => channel.models.filter(model => model.capability === "image").map(model => ({
        value: `${channel.id}::${model.name}`,
        label: `${channel.name} · ${model.label || model.name}${model.imageInputs === undefined ? "（参考图能力未知）" : model.imageInputs < references ? `（需至少${references}张参考图）` : ""}`,
        disabled: model.imageInputs === undefined || model.imageInputs < references,
    })));
}
export function poseModelInputs(config: AiConfig, value: string): number {
    const [channel, ...rest] = value.split("::");
    return config.channels.find(c => c.id === channel)?.models.find(m => m.name === rest.join("::"))?.imageInputs ?? 1;
}
export function resolvePoseConfig(config: AiConfig, settings: PoseSettings) {
    const requireModel = (value: string | undefined, refs: number) => {
        if (!value) throw new Error("请选择本轮使用的图像模型");
        const option = poseModelOptions(config, refs).find(o => o.value === value);
        if (!option) throw new Error("所选图像模型已不存在，请重新选择");
        const capability = config.channels.find(c => c.id === value.split("::")[0])?.models.find(m => m.name === value.split("::").slice(1).join("::"))?.imageInputs;
        if (capability === undefined) throw new Error(`所选模型未声明参考图能力，无法确认支持${refs}张参考图`);
        if (capability < refs) throw new Error(`所选模型最多支持${capability}张参考图，本轮需要${refs}张`);
        return option.value;
    };
    const characterModel = requireModel(settings.characterModel, 1);
    const portraitModel = settings.layout === "natural" ? requireModel(settings.portraitModel, 2) : undefined;
    const gatewayOrigin = new URL(LOCAL_GATEWAY_BASE_URL).origin;
    const isRuntimeGateway = (baseUrl: string) => { try { return new URL(baseUrl).origin === gatewayOrigin; } catch { return false; } };
    const gateway = config.channels.find(c => c.id === "local-gateway" && isLocalGatewayUrl(c.baseUrl))
        || config.channels.find(c => isRuntimeGateway(c.baseUrl));
    if (!gateway) throw new Error("未找到已配置的本地网关，动作识别仍需本地网关转发");
    const captionConfig: AiConfig = { ...config, model: `${gateway.id}::${gateway.models[0]?.name || "caption"}` };
    let cloud: { baseUrl: string; apiKey: string; model: string } | undefined;
    let cloudApiId: string | undefined;
    if (settings.engine === "cloud") {
        const apis = config.promptCloudApis || [];
        const api = settings.cloudApiId
            ? apis.find(a => a.id === settings.cloudApiId)
            : config.promptCloudApiId ? apis.find(a => a.id === config.promptCloudApiId) || null : apis[0] || null;
        if (settings.cloudApiId && !api) throw new Error("所选云端反推配置已删除，请重新选择");
        if (api) { cloud = { baseUrl: api.baseUrl.trim(), apiKey: api.apiKey.trim(), model: api.model.trim() }; cloudApiId = api.id; }
        else cloud = { baseUrl: (config.promptCloudBaseUrl || "").trim(), apiKey: (config.promptCloudApiKey || "").trim(), model: (config.promptCloudModel || "").trim() };
        if (!cloud.baseUrl || !cloud.apiKey || !cloud.model) throw new Error("请先在设置中添加完整的云端反推配置");
    }
    return { captionConfig, cloud, cloudApiId, characterModel, portraitModel };
}
