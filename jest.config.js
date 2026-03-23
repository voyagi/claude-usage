/** @type {import('jest').Config} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	testMatch: ["**/*.test.ts"],
	collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts", "!src/types.ts"],
	moduleFileExtensions: ["ts", "js"],
	moduleNameMapper: {
		"^(\\.\\.?/.*)\\.js$": "$1",
	},
	transform: {
		"^.+\\.ts$": "ts-jest",
	},
};
