import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
export const AllowedModelRouteSchema = z.object({
    provider: z.string().min(1).required(),
    model: z.string().min(1).required(),
});
export function modelRouteKey(route) {
    return `${route.provider}\0${route.model}`;
}
export function assertAllowedModelRoutes(routes) {
    if (!Array.isArray(routes)) {
        throw new Error('subagent model selection requires an array of routes');
    }
    const seen = new Set();
    const candidates = routes;
    for (const candidate of candidates) {
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)
            || !('provider' in candidate) || typeof candidate.provider !== 'string'
            || !('model' in candidate) || typeof candidate.model !== 'string'
            || candidate.provider.length === 0 || candidate.model.length === 0) {
            throw new Error('subagent model selection requires non-empty provider and model ids');
        }
        const route = { provider: candidate.provider, model: candidate.model };
        const key = modelRouteKey(route);
        if (seen.has(key)) {
            throw new Error(`subagent model selection repeats route "${route.provider}/${route.model}"`);
        }
        seen.add(key);
    }
}
export function hasDelegationModelRequest(request) {
    return request.provider !== undefined
        || request.model !== undefined
        || request.reasoning_effort !== undefined;
}
function assertNonEmpty(value, field) {
    if (value !== undefined && value.length === 0) {
        throw new Error(`child LLM \`${field}\` must be non-empty`);
    }
}
export function requestedAgentOptions(parentOptions, configured, request, enabled) {
    if (!hasDelegationModelRequest(request))
        return configured;
    if (!enabled) {
        throw new Error('child model selection is disabled for this tool instance');
    }
    assertNonEmpty(request.provider, 'provider');
    assertNonEmpty(request.model, 'model');
    assertNonEmpty(request.reasoning_effort, 'reasoning_effort');
    if ((request.provider === undefined) !== (request.model === undefined)) {
        throw new Error('child LLM `provider` and `model` must be supplied together');
    }
    const baselineProvider = configured?.provider ?? parentOptions.provider;
    const baselineModel = configured?.model ?? parentOptions.model;
    const routeChanged = request.provider !== undefined
        && (request.provider !== baselineProvider || request.model !== baselineModel);
    const { reasoningEffort: _configuredReasoningEffort, ...configuredWithoutReasoning } = configured ?? {};
    return {
        ...routeChanged && request.reasoning_effort === undefined ? configuredWithoutReasoning : configured,
        ...request.provider === undefined ? {} : { provider: request.provider, model: request.model },
        ...request.reasoning_effort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(request.reasoning_effort) },
    };
}
export function assertAllowedModelSelection(policy, parentOptions, requested, request) {
    if (policy === undefined || !hasDelegationModelRequest(request))
        return;
    const provider = requested?.provider ?? parentOptions.provider;
    const model = requested?.model ?? parentOptions.model;
    if (provider === undefined || model === undefined) {
        throw new Error('cannot select child LLM values without an effective provider and model');
    }
    if (policy.routes.some(route => route.provider === provider && route.model === model))
        return;
    throw new Error(`child LLM route "${provider}/${model}" is not allowed for this Session`);
}
export function hasConfiguredLlmSelection(options) {
    return options?.provider !== undefined
        || options?.model !== undefined
        || options?.reasoningEffort !== undefined;
}
export async function preflightChildLlmRoute(llm, parentOptions, requested, signal, inheritParentReasoningEffort = true) {
    const provider = requested?.provider ?? parentOptions.provider;
    const model = requested?.model ?? parentOptions.model;
    if (provider === undefined || model === undefined) {
        throw new Error('cannot select child LLM values without an effective provider and model');
    }
    const routeChanged = provider !== parentOptions.provider || model !== parentOptions.model;
    const reasoningEffort = requested?.reasoningEffort
        ?? (inheritParentReasoningEffort && !routeChanged ? parentOptions.reasoningEffort : undefined);
    await llm.resolveCallConfig({
        provider,
        model,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
    }, signal);
}
