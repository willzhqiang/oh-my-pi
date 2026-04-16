import * as fs from "node:fs/promises";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import type { ToolSession } from ".";
import type { OutputMeta } from "./output-meta";
import { resolveToCwd } from "./path-utils";
import { ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";

const readLinesSchema = Type.Object({
	path: Type.String({ description: "Path to the text file to read" }),
	start_line: Type.Number({ description: "1-indexed first line to read (inclusive)" }),
	end_line: Type.Optional(Type.Number({ description: "1-indexed last line to read (inclusive). Defaults to start_line." })),
	include_line_numbers: Type.Optional(
		Type.Boolean({ description: "Include `N|` prefixes in the output (default: true)" }),
	),
});

export type ReadLinesToolInput = Static<typeof readLinesSchema>;

export interface ReadLinesToolDetails {
	path: string;
	startLine: number;
	endLine: number;
	totalLines: number;
	returnedLines: number;
	meta?: OutputMeta;
}

function splitTextLines(text: string): string[] {
	if (text.length === 0) return [];
	const normalized = text.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	if (normalized.endsWith("\n")) {
		lines.pop();
	}
	return lines;
}

function formatWithLineNumbers(lines: string[], startLine: number): string {
	const endLine = startLine + lines.length - 1;
	const padWidth = String(endLine).length;
	return lines
		.map((line, index) => `${String(startLine + index).padStart(padWidth, " ")}|${line}`)
		.join("\n");
}

export class ReadLinesTool implements AgentTool<typeof readLinesSchema, ReadLinesToolDetails> {
	readonly name = "read_lines";
	readonly label = "Read Lines";
	readonly description =
		"Read an exact inclusive line range from a local text file. Prefer this over read when precise context is needed from large files.";
	readonly parameters = readLinesSchema;
	readonly strict = true;

	constructor(readonly session: ToolSession) {}

	async execute(
		_toolCallId: string,
		params: ReadLinesToolInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ReadLinesToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<ReadLinesToolDetails>> {
		const startLine = Math.trunc(params.start_line);
		const endLine = Math.trunc(params.end_line ?? params.start_line);
		if (!Number.isFinite(startLine) || startLine < 1) {
			throw new ToolError("start_line must be a positive integer");
		}
		if (!Number.isFinite(endLine) || endLine < 1) {
			throw new ToolError("end_line must be a positive integer");
		}
		if (endLine < startLine) {
			throw new ToolError("end_line must be greater than or equal to start_line");
		}

		const absolutePath = resolveToCwd(params.path, this.session.cwd);
		let stat: Awaited<ReturnType<typeof fs.stat>>;
		try {
			stat = await fs.stat(absolutePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ToolError(`Cannot access file: ${message}`);
		}
		if (!stat.isFile()) {
			throw new ToolError(`Path is not a file: ${params.path}`);
		}

		const content = await fs.readFile(absolutePath, "utf8");
		const lines = splitTextLines(content);
		if (lines.length === 0) {
			throw new ToolError("File is empty");
		}
		if (startLine > lines.length) {
			throw new ToolError(`start_line ${startLine} is beyond end of file (${lines.length} lines)`);
		}

		const clampedEndLine = Math.min(endLine, lines.length);
		const selected = lines.slice(startLine - 1, clampedEndLine);
		const includeLineNumbers = params.include_line_numbers ?? true;
		const text = includeLineNumbers ? formatWithLineNumbers(selected, startLine) : selected.join("\n");
		const details: ReadLinesToolDetails = {
			path: params.path,
			startLine,
			endLine: clampedEndLine,
			totalLines: lines.length,
			returnedLines: selected.length,
		};

		return toolResult(details).text(text).done();
	}
}
