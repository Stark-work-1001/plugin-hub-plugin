import { defineTool } from "@deepseek-ai/dsh-tools";
const name = "tool-worktree";
const inject = ["tools", "worktrees"];
function apply(ctx, config = {}) {
    ctx.tools.register(defineTool({
        name: config.toolName ?? "plugin_hub_create_worktree",
        description: "Create a new Git branch and worktree from a local commit, branch, or tag, then change this session's working directory to it. Defaults to HEAD and a generated name. Uncommitted files stay in the source checkout. Existing names fail. Use working_directory with cd to leave; the checkout and branch remain.",
        parameters: {
            name: {
                type: "string",
                description: "New branch name, also used as the checkout directory. Omit to generate a unique name."
            },
            from: {
                type: "string",
                description: "Local commit, branch, or tag to start from. Defaults to HEAD; no fetch is performed."
            }
        },
        output: {
            schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    path: {
                        type: "string",
                        required: true
                    },
                    branch: {
                        type: "string",
                        required: true
                    },
                    baseCommit: {
                        type: "string",
                        required: true
                    },
                    repositoryRoot: {
                        type: "string",
                        required: true
                    }
                }
            },
            render: (_args, value) => [{
                    type: "text",
                    text: JSON.stringify(value)
                }]
        },
        async execute(args, exec) {
            if (exec.agent === void 0)
                throw new Error("create_worktree requires a calling agent");
            return ctx.worktrees.create(exec.agent, args, exec.signal);
        },
        presentCall: (args) => ({
            card: "generic",
            title: "create_worktree",
            rawInput: args
        })
    }));
}
export { apply, inject, name };
