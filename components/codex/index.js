import { mountComponent } from "../../lib/embedded.js";
export const name = "plugin-hub-component-codex";
export const inject = [];
export function apply(ctx) { return mountComponent(ctx, "codex"); }
