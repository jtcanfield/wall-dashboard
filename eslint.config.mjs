import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * Formatting is Prettier's job; ESLint only enforces what Prettier cannot
 * express.
 *
 * Note the ordering: `eslint-config-prettier` comes *before* the project rules,
 * not last as its README suggests. It turns off `curly` unconditionally, and
 * this project requires braces on every branch. Only `curly: "multi-line"` and
 * `"multi-or-nest"` genuinely conflict with Prettier — `"all"` does not, so it
 * is safe to switch back on afterwards. With prettier last, the brace rule is
 * silently disabled and lint passes on code it should reject.
 */
export default tseslint.config(
    {
        ignores: ["**/dist/**", "**/node_modules/**", "**/*.tsbuildinfo", "server/data/**"],
    },

    js.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,

    {
        rules: {
            // Every branch gets a block. No single-line bodies: the shape of the
            // control flow should be obvious without reading to the end of the
            // statement.
            curly: ["error", "all"],
            "nonblock-statement-body-position": ["error", "beside"],
            eqeqeq: ["error", "smart"],
            "no-var": "error",
            "prefer-const": "error",
            "object-shorthand": ["error", "always"],
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
        },
    },

    {
        files: ["server/**/*.ts", "scripts/**/*.mjs", "*.mjs", "*.ts"],
        languageOptions: {
            globals: { ...globals.node },
        },
    },

    {
        // Plain CommonJS config files (jest.config.js) — module/require globals.
        files: ["**/*.js"],
        languageOptions: {
            sourceType: "commonjs",
            globals: { ...globals.node },
        },
    },

    {
        files: ["client/**/*.ts", "client/**/*.tsx"],
        languageOptions: {
            globals: { ...globals.browser },
        },
    },

    {
        files: ["**/*.spec.ts"],
        languageOptions: {
            globals: { ...globals.node, ...globals.jest },
        },
    },
);
