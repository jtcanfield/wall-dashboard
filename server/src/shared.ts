/**
 * The one place the server reaches across the workspace into `shared/`.
 *
 * Everything else imports from here, so if the layout moves there is exactly
 * one relative path to fix. A TS path alias would be prettier, but Nest needs
 * `emitDecoratorMetadata` (so tsc, not esbuild) and making an alias resolve at
 * *runtime* means adding tsc-alias or tsconfig-paths — tooling this repo has
 * deliberately gone without.
 */
export * from "../../shared/types";
