/** @type {import('jest').Config} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	// .tsx included deliberately: the webview is React, and matching only .ts
	// meant none of the dashboard's rendering could be tested at all. Guards
	// added there were unverifiable, which is how "$0.00" for an unknown balance
	// survived three rounds of review.
	testMatch: ["**/*.test.ts", "**/*.test.tsx"],
	collectCoverageFrom: [
		"src/**/*.ts",
		"src/**/*.tsx",
		"!src/**/*.test.ts",
		"!src/**/*.test.tsx",
		"!src/types.ts",
	],
	moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
	moduleNameMapper: {
		"^(\\.\\.?/.*)\\.js$": "$1",
		// Components import their stylesheet for esbuild's benefit; jest has no
		// CSS loader and does not need one.
		"\\.css$": "<rootDir>/src/webview/app/__mocks__/styleMock.js",
	},
	transform: {
		"^.+\\.tsx?$": "ts-jest",
	},
};
