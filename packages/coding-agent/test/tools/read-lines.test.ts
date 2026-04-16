import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { ReadLinesTool } from "@oh-my-pi/pi-coding-agent/tools/read-lines";

function createSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
	};
}

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter(block => block.type === "text")
		.map(block => block.text ?? "")
		.join("\n");
}

describe("ReadLinesTool", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-lines-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("reads an exact inclusive line range with line numbers by default", async () => {
		const filePath = path.join(tmpDir, "sample.ts");
		await fs.writeFile(filePath, ["alpha", "beta", "gamma", "delta"].join("\n"), "utf8");
		const tool = new ReadLinesTool(createSession(tmpDir));

		const result = await tool.execute("tool-1", {
			path: filePath,
			start_line: 2,
			end_line: 3,
		});

		expect(getText(result)).toBe("2|beta\n3|gamma");
		expect(result.details).toEqual({
			path: filePath,
			startLine: 2,
			endLine: 3,
			totalLines: 4,
			returnedLines: 2,
		});
	});

	it("can omit line numbers and clamps end_line to file length", async () => {
		const filePath = path.join(tmpDir, "sample.ts");
		await fs.writeFile(filePath, ["one", "two", "three"].join("\n"), "utf8");
		const tool = new ReadLinesTool(createSession(tmpDir));

		const result = await tool.execute("tool-2", {
			path: filePath,
			start_line: 2,
			end_line: 99,
			include_line_numbers: false,
		});

		expect(getText(result)).toBe("two\nthree");
		expect(result.details?.endLine).toBe(3);
	});

	it("rejects invalid line ranges", async () => {
		const filePath = path.join(tmpDir, "sample.ts");
		await fs.writeFile(filePath, ["one", "two"].join("\n"), "utf8");
		const tool = new ReadLinesTool(createSession(tmpDir));

		await expect(
			tool.execute("tool-3", {
				path: filePath,
				start_line: 3,
			}),
		).rejects.toThrow("start_line 3 is beyond end of file (2 lines)");
	});
});
