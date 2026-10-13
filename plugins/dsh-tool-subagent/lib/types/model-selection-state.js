import { z as zod } from 'zod';
import { assertAllowedModelRoutes } from "./model-selection.js";
const modelSelectionPolicySchema = zod.array(zod.object({
    provider: zod.string().min(1),
    model: zod.string().min(1),
}).strict()).min(1).nullable();
export const subagentModelSelectionProjectionDefinition = {
    key: 'subagentModelSelectionPolicy',
    stateVersion: 1,
    stateSchema: modelSelectionPolicySchema,
    init: () => null,
    apply: (policy, event) => {
        if (policy !== null || event.type !== 'subagent/model-selection-policy')
            return policy;
        const { allowedModels } = event.data;
        assertAllowedModelRoutes(allowedModels);
        if (allowedModels.length === 0) {
            throw new Error('subagent/model-selection-policy requires at least one route');
        }
        return allowedModels;
    },
};
export function subagentModelSelectionPolicy(projections, session) {
    return projections.stateOf(session, 'subagentModelSelectionPolicy')?.map(route => ({ ...route }));
}
export function recordSubagentModelSelection(projections, session, allowedModels) {
    if (subagentModelSelectionPolicy(projections, session) !== undefined)
        return;
    session.append('subagent/model-selection-policy', {
        allowedModels: allowedModels.map(route => ({ ...route })),
    });
}
