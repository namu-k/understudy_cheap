import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "tests/**/*.test.ts"],
		testTimeout: 30000,
		hookTimeout: 60000,
		coverage: {
			provider: "v8",
			// M1 core runtime paths: core + gateway + tools + web channel.
			include: [
				"packages/core/src/**/*.ts",
				"packages/gateway/src/**/*.ts",
				"packages/tools/src/**/*.ts",
				"packages/channels/src/**/*.ts",
				"packages/gui/src/**/*.ts",
			],
			// Channel implementations (discord, slack, telegram, whatsapp) are excluded
			// from coverage because they depend on optionalDependencies (grammy,
			// discord.js, @slack/bolt, baileys) that may not be installed. Their
			// adapters are tested individually when the dependencies are available.
			exclude: [
				"**/*.test.ts",
				"**/*.d.ts",
				"**/index.ts",
				"**/node_modules/**",
				"apps/**",
				"packages/types/**",
				"packages/gateway/src/protocol.ts",
				"packages/channels/src/discord/**",
				"packages/channels/src/slack/**",
				"packages/channels/src/telegram/**",
				"packages/channels/src/whatsapp/**",
			],
			thresholds: {
				statements: 70,
				branches: 70,
				functions: 70,
				lines: 70,
			},
		},
	},
});
