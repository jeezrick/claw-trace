import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLAW_TRACE_COMMAND = "__CLAW_TRACE_COMMAND__";
const INCLUDE_AI = "__CLAW_TRACE_WITH_AI__" === "1";
const MAX_OUTPUT_CHARS = 12000;

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function trimOutput(text) {
  const normalized = stripAnsi((text || "").trim());

  if (!normalized) {
    return normalized;
  }

  if (normalized.length <= MAX_OUTPUT_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_OUTPUT_CHARS)}\n\n[输出已截断]`;
}

function resolveCommandPath() {
  const candidates = [
    CLAW_TRACE_COMMAND,
    process.env.CLAW_TRACE_DOCTOR_COMMAND,
    "/root/.local/bin/claw-trace",
    "/usr/local/bin/claw-trace",
    "/root/claw-trace/claw-trace",
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || CLAW_TRACE_COMMAND;
}

async function runDoctor() {
  const command = resolveCommandPath();
  const args = INCLUDE_AI ? ["diagnosis"] : ["diagnosis", "--no-ai"];
  const env = {
    ...process.env,
    HOME: process.env.HOME || "/root",
  };

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      env,
    });

    const output = trimOutput(stdout || stderr || "");

    if (!output) {
      return { text: "doctor 执行完成，但没有输出。" };
    }

    return {
      text: `诊断结果如下：\n\n${output}`,
    };
  } catch (error) {
    const message =
      trimOutput(error?.stderr || error?.stdout || error?.message || String(error)) ||
      "unknown error";

    return {
      text: `doctor 执行失败：\n${message}`,
    };
  }
}

const plugin = {
  id: "claw-trace-doctor-plugin",
  name: "Claw Trace Doctor",
  description: "Run claw-trace diagnosis and return the report",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },

  register(api) {
    const commandSpec = {
      description: "运行 claw-trace diagnosis 并返回诊断报告",
      acceptsArgs: false,
      requireAuth: true,
      async handler() {
        return runDoctor();
      },
    };

    api.registerCommand({
      name: "doctor",
      ...commandSpec,
    });

    api.registerCommand({
      name: "claw_trace_doctor",
      ...commandSpec,
    });
  },
};

export default plugin;
