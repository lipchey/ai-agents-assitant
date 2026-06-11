/* Deterministic scripted ChatProvider (R8 offline seam): responses are keyed by
   role and consumed in order through a per-role ordinal counter, so a full agent
   run replays a canned script with no network, file I/O, or retry wrapper. A
   fresh provider instance resets the counters, which is why tests install a new
   one per run. A missing role key or an exhausted script throws — a loud,
   deterministic test failure rather than a hang. */
import { ModelTransport } from "../../consts";
import type { ModelRole } from "../../consts";
import type { ProviderUsage } from "../../types/tools";
import type { ChatProvider } from "../provider.ts";

export type FakeScriptStep = string | { text: string; usage?: ProviderUsage };
export type FakeChatScript = Partial<Record<ModelRole, readonly FakeScriptStep[]>>;

/* openclaw-style fields so src/tools/pricing.ts calculateUsage prices a fake run
   exactly as a live one; a step may override this with its own usage. */
const DEFAULT_FAKE_USAGE: ProviderUsage = { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 };

export const createFakeChatProvider = (script: FakeChatScript): ChatProvider => {
    const ordinals = new Map<ModelRole, number>();
    return {
        kind: ModelTransport.FAKE,
        call: async (role, binding) => {
            const steps = script[role];
            const ordinal = ordinals.get(role) ?? 0;
            const step = steps?.[ordinal];
            if (step === undefined) {
                throw new Error(
                    `Fake chat provider has no scripted step for role "${role}" at ordinal ${ordinal} ` +
                        `(${steps ? `${steps.length} step(s) scripted` : "role not scripted"}).`,
                );
            }
            ordinals.set(role, ordinal + 1);
            const text = typeof step === "string" ? step : step.text;
            const usage = typeof step === "string" ? DEFAULT_FAKE_USAGE : (step.usage ?? DEFAULT_FAKE_USAGE);
            /* structuredSchema is intentionally ignored (no `parsed`): scripted text
               flows through the existing text parsers, same as the openclaw transport. */
            return { text, usage, pricingKey: binding.model };
        },
    };
};
