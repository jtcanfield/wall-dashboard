/** Kept out of package.json so the regexes don't need JSON escaping. */
module.exports = {
    moduleFileExtensions: ["js", "json", "ts"],
    rootDir: ".",
    testRegex: ".*[.]spec[.]ts$",
    transform: { "^.+[.]ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
    testEnvironment: "node",
};
