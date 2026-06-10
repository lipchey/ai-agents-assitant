import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/* Local rule mirroring code-guidelines §5: block comments only, never // line comments. */
const projectPlugin = {
    rules: {
        "block-comments-only": {
            meta: {
                type: "problem",
                docs: { description: "Disallow // line comments; use /* block */ comments." },
                schema: [],
                messages: { noLine: "Use /* block */ comments, not // line comments (code-guidelines §5)." },
            },
            create(context) {
                return {
                    Program() {
                        for (const comment of context.sourceCode.getAllComments()) {
                            if (comment.type === "Line") {
                                context.report({ loc: comment.loc, messageId: "noLine" });
                            }
                        }
                    },
                };
            },
        },
    },
};

export default tseslint.config(
    { ignores: ["dist/**", "node_modules/**", "eslint.config.js", "tools/**", "schemas/**"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["**/*.ts"],
        plugins: { project: projectPlugin },
        rules: {
            "project/block-comments-only": "error",
            "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        },
    },
    eslintConfigPrettier,
);
