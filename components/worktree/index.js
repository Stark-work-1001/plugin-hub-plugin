import { mountComponent } from "../../lib/embedded.js";
export const name = "plugin-hub-component-worktree";
export const inject = [];
export function apply(ctx) { return mountComponent(ctx, "worktree"); }
