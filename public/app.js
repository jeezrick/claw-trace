const state = {
  sessions: [],
  searchQuery: "",
  selectedSessionKey: null,
  selectedSessionEvents: [],
  terminalMessages: [],
  selectedTerminalIndex: null,
  sessionCache: new Map(),
  localFiles: new Map(),
};

const elements = {
  statusBar: document.querySelector("#statusBar"),
  sessionCount: document.querySelector("#sessionCount"),
  messageCount: document.querySelector("#messageCount"),
  sessionList: document.querySelector("#sessionList"),
  sessionMeta: document.querySelector("#sessionMeta"),
  messageList: document.querySelector("#messageList"),
  chainSummary: document.querySelector("#chainSummary"),
  chainTimeline: document.querySelector("#chainTimeline"),
  sessionSearch: document.querySelector("#sessionSearch"),
  reloadButton: document.querySelector("#reloadButton"),
  fileButton: document.querySelector("#fileButton"),
  fileInput: document.querySelector("#fileInput"),
};

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function setStatus(message, tone = "info") {
  elements.statusBar.dataset.tone = tone;
  elements.statusBar.textContent = message;
}

function basename(filePath = "") {
  return filePath.split("/").pop() || filePath;
}

function formatAbsoluteTime(value) {
  if (!value) {
    return "未知时间";
  }

  const date =
    typeof value === "number" ? new Date(value) : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return timeFormatter.format(date);
}

function previewText(value, maxLength = 110) {
  const singleLine = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!singleLine) {
    return "(空文本)";
  }

  return singleLine.length > maxLength
    ? `${singleLine.slice(0, maxLength - 1)}…`
    : singleLine;
}

function truncateTail(value, maxLength = 72) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function truncateMiddle(value, maxLength = 40) {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (text.length <= maxLength) return text;

  const side = Math.max(6, Math.floor((maxLength - 1) / 2));
  return `${text.slice(0, side)}…${text.slice(-side)}`;
}

function extractTextContent(content = []) {
  return content
    .filter((item) => item && item.type === "text")
    .map((item) => item.text || "")
    .join("\n\n")
    .trim();
}

function cleanAssistantText(text) {
  return String(text || "")
    .replace(/\[\[reply_to_current\]\]\s*/g, "")
    .trim();
}

function normalizeUserText(text) {
  const raw = String(text || "").trim();

  if (!raw) {
    return "";
  }

  const marker = raw.lastIndexOf("[message_id:");
  if (marker >= 0) {
    const afterMarker = raw.slice(raw.indexOf("\n", marker) + 1).trim();
    if (afterMarker) {
      const newlineIndex = afterMarker.indexOf("\n");
      if (newlineIndex >= 0) {
        const firstLine = afterMarker.slice(0, newlineIndex);
        const rest = afterMarker.slice(newlineIndex + 1).trim();
        return `${stripSpeakerPrefix(firstLine)}${rest ? `\n${rest}` : ""}`.trim();
      }
      return stripSpeakerPrefix(afterMarker).trim();
    }
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length) {
    const lastLine = lines[lines.length - 1].replace(/^\[[^\]]+\]\s*/, "").trim();
    if (lastLine) {
      return stripSpeakerPrefix(lastLine);
    }
  }

  return stripSpeakerPrefix(raw.replace(/^\[[^\]]+\]\s*/, ""));
}

function stripSpeakerPrefix(text) {
  const line = String(text || "");
  const match = line.match(/^[^:\n]{1,120}:\s*([\s\S]*)$/);
  return match ? match[1].trim() : line.trim();
}

function prettyValue(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function parseSessionsIndex(text) {
  const parsed = JSON.parse(text);

  return Object.entries(parsed)
    .map(([key, value]) => ({
      key,
      sessionId: value.sessionId || basename(value.sessionFile || ""),
      sessionFile: basename(value.sessionFile || `${value.sessionId}.jsonl`),
      updatedAt: Number(value.updatedAt || 0),
      provider:
        value.origin?.provider || value.deliveryContext?.channel || "unknown",
      chatType: value.chatType || value.origin?.chatType || "unknown",
      label:
        value.origin?.label ||
        value.deliveryContext?.to ||
        value.lastTo ||
        key,
      deliveryTarget:
        value.deliveryContext?.to || value.lastTo || value.origin?.to || "-",
      raw: value,
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line);
      parsed.__rowIndex = index;
      return parsed;
    });
}

function isTerminalAssistantMessage(event) {
  return (
    event?.type === "message" &&
    event.message?.role === "assistant" &&
    event.message?.stopReason === "stop"
  );
}

function buildTerminalMessages(events) {
  return events
    .filter(isTerminalAssistantMessage)
    .map((event, index) => {
      const text = cleanAssistantText(extractTextContent(event.message.content));

      return {
        ordinal: index + 1,
        rowIndex: event.__rowIndex,
        id: event.id,
        timestamp: event.timestamp,
        preview: previewText(text),
        fullText: text || "(空文本)",
        event,
      };
    });
}

function detectToolResultError(message) {
  if (!message) {
    return false;
  }

  if (message.isError || message.details?.status === "error") {
    return true;
  }

  const text = extractTextContent(message.content || []);
  return /"status"\s*:\s*"error"/i.test(text);
}

function buildChainSteps(events) {
  const steps = [];

  for (const event of events) {
    if (event.type !== "message") {
      continue;
    }

    const message = event.message || {};
    const role = message.role;

    if (role === "user") {
      const userText = normalizeUserText(extractTextContent(message.content));
      steps.push({
        kind: "user",
        label: "USER",
        title: "User Message",
        timestamp: event.timestamp,
        body: userText || "(空文本)",
        meta: `row ${event.__rowIndex}`,
      });
      continue;
    }

    if (role === "assistant") {
      const content = Array.isArray(message.content) ? message.content : [];

      if (!content.length && message.stopReason === "error") {
        steps.push({
          kind: "assistantError",
          label: "ERROR",
          title: "Assistant Error",
          timestamp: event.timestamp,
          body: message.errorMessage || "模型请求失败，没有返回内容。",
          meta: `row ${event.__rowIndex} · stopReason=${message.stopReason}`,
          isError: true,
        });
      }

      for (const item of content) {
        if (item.type === "thinking") {
          steps.push({
            kind: "think",
            label: "THINK",
            title: "Reasoning Trace",
            timestamp: event.timestamp,
            body: item.thinking || "(空 thinking)",
            meta: `row ${event.__rowIndex}`,
          });
          continue;
        }

        if (item.type === "toolCall") {
          steps.push({
            kind: "toolCall",
            label: "TOOL CALL",
            title: item.name || "unknown tool",
            timestamp: event.timestamp,
            body: prettyValue(item.arguments),
            meta: `row ${event.__rowIndex} · callId=${item.id || "-"}`,
          });
          continue;
        }

        if (item.type === "text") {
          const text = cleanAssistantText(item.text || "");
          const isFinalReply = message.stopReason === "stop";
          steps.push({
            kind: isFinalReply ? "reply" : "assistantText",
            label: isFinalReply ? "FINAL" : "ASSISTANT",
            title: isFinalReply ? "Final Reply" : "Assistant Text",
            timestamp: event.timestamp,
            body: text || "(空文本)",
            meta: `row ${event.__rowIndex} · stopReason=${message.stopReason || "-"}`,
          });
          continue;
        }

        steps.push({
          kind: "assistantText",
          label: "ASSISTANT",
          title: item.type || "assistant content",
          timestamp: event.timestamp,
          body: prettyValue(item),
          meta: `row ${event.__rowIndex}`,
        });
      }

      if (
        message.stopReason &&
        message.stopReason !== "stop" &&
        message.stopReason !== "toolUse" &&
        message.stopReason !== "error"
      ) {
        steps.push({
          kind: "assistantError",
          label: "STOP",
          title: `stopReason = ${message.stopReason}`,
          timestamp: event.timestamp,
          body: message.errorMessage || "该 assistant 消息以异常 stopReason 结束。",
          meta: `row ${event.__rowIndex}`,
          isError: true,
        });
      }

      continue;
    }

    if (role === "toolResult") {
      const toolResultText =
        extractTextContent(message.content) || prettyValue(message.details);
      steps.push({
        kind: "toolResult",
        label: "RESULT",
        title: message.toolName || "tool result",
        timestamp: event.timestamp,
        body: toolResultText || "(空结果)",
        meta: `row ${event.__rowIndex} · callId=${message.toolCallId || "-"}`,
        isError: detectToolResultError(message),
      });
    }
  }

  return steps;
}

function summarizeSteps(steps) {
  const summary = {
    user: 0,
    think: 0,
    toolCall: 0,
    toolResult: 0,
    reply: 0,
    assistantError: 0,
    assistantText: 0,
    tools: new Set(),
  };

  for (const step of steps) {
    if (summary[step.kind] != null) {
      summary[step.kind] += 1;
    }

    if (step.kind === "toolCall" && step.title) {
      summary.tools.add(step.title);
    }
  }

  return summary;
}

async function readTextAsset(fileName) {
  const localFile = state.localFiles.get(fileName);
  if (localFile) {
    return localFile.text();
  }

  const target =
    fileName === "sessions.json"
      ? "/api/sessions"
      : `/api/session-file?file=${encodeURIComponent(fileName)}`;

  const response = await fetch(target, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`读取 ${fileName} 失败（${response.status}）`);
  }

  return response.text();
}

function filteredSessions() {
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) {
    return state.sessions;
  }

  return state.sessions.filter((session) => {
    const haystack = [
      session.key,
      session.sessionId,
      session.sessionFile,
      session.provider,
      session.chatType,
      session.label,
      session.deliveryTarget,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function clearElement(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function createBadge(text) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = text;
  return badge;
}

function createSummaryPill(text) {
  const pill = document.createElement("span");
  pill.className = "summary-pill";
  pill.textContent = text;
  return pill;
}

function createSnippet(text) {
  const pre = document.createElement("pre");
  pre.className = "snippet";
  pre.textContent = text;
  return pre;
}

function appendExpandableContent(container, text) {
  if (!text) {
    return;
  }

  const shouldCollapse = text.length > 360 || text.split("\n").length > 10;
  if (!shouldCollapse) {
    container.appendChild(createSnippet(text));
    return;
  }

  const details = document.createElement("details");
  details.className = "expandable";
  const summary = document.createElement("summary");
  summary.textContent = "展开完整内容";
  details.appendChild(summary);
  details.appendChild(createSnippet(text));
  container.appendChild(details);
}

function renderSessions() {
  clearElement(elements.sessionList);

  const sessions = filteredSessions();
  elements.sessionCount.textContent = String(sessions.length);

  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "没有匹配的 session。你可以修改搜索条件，或者手动导入本地文件。";
    elements.sessionList.appendChild(empty);
    return;
  }

  for (const session of sessions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "list-card";
    if (session.key === state.selectedSessionKey) {
      button.classList.add("active");
    }

    const title = document.createElement("p");
    title.className = "list-card-title";
    title.textContent = truncateTail(session.label, 120);
    title.title = String(session.label || "");
    button.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "list-card-meta";
    meta.textContent = `${truncateMiddle(session.sessionFile, 44)} · ${formatAbsoluteTime(session.updatedAt)}`;
    meta.title = `${session.sessionFile} · ${formatAbsoluteTime(session.updatedAt)}`;
    button.appendChild(meta);

    const badges = document.createElement("div");
    badges.className = "badge-row";
    badges.appendChild(createBadge(truncateTail(session.provider, 24)));
    badges.appendChild(createBadge(truncateTail(session.chatType, 18)));
    badges.appendChild(createBadge(truncateMiddle(session.sessionId, 28)));
    button.appendChild(badges);

    button.addEventListener("click", () => {
      selectSession(session.key);
    });

    elements.sessionList.appendChild(button);
  }
}

function renderSessionMeta(session) {
  clearElement(elements.sessionMeta);

  if (!session) {
    elements.sessionMeta.className = "session-meta empty-note";
    elements.sessionMeta.textContent = "选择一个 session 之后，这里会展示终端消息列表。";
    return;
  }

  elements.sessionMeta.className = "session-meta";

  const top = document.createElement("p");
  top.textContent = `${truncateTail(session.label, 120)} · ${truncateTail(session.provider, 24)} / ${truncateTail(session.chatType, 18)}`;
  top.title = `${session.label} · ${session.provider} / ${session.chatType}`;
  elements.sessionMeta.appendChild(top);

  const bottom = document.createElement("p");
  bottom.textContent = `sessionId=${truncateMiddle(session.sessionId, 36)} · ${truncateMiddle(session.sessionFile, 56)}`;
  bottom.title = `sessionId=${session.sessionId} · ${session.sessionFile}`;
  elements.sessionMeta.appendChild(bottom);
}

function renderTerminalMessages() {
  clearElement(elements.messageList);

  const count = state.terminalMessages.length;
  elements.messageCount.textContent = String(count);

  if (!state.selectedSessionKey) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "先从左侧选择一个 session。";
    elements.messageList.appendChild(empty);
    return;
  }

  if (!count) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "这个 session 里没有 assistant + stopReason=stop 的终端消息。";
    elements.messageList.appendChild(empty);
    return;
  }

  for (let index = 0; index < state.terminalMessages.length; index += 1) {
    const terminal = state.terminalMessages[index];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "list-card";

    if (index === state.selectedTerminalIndex) {
      button.classList.add("active");
    }

    const title = document.createElement("p");
    title.className = "list-card-title";
    title.textContent = `#${terminal.ordinal} · ${terminal.preview}`;
    button.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "list-card-meta";
    meta.textContent = `${formatAbsoluteTime(terminal.timestamp)} · row ${terminal.rowIndex}`;
    button.appendChild(meta);

    const preview = document.createElement("p");
    preview.className = "list-card-preview";
    preview.textContent = terminal.fullText;
    button.appendChild(preview);

    button.addEventListener("click", () => {
      state.selectedTerminalIndex = index;
      renderTerminalMessages();
      renderChain();
    });

    elements.messageList.appendChild(button);
  }
}

function renderChain() {
  clearElement(elements.chainSummary);
  clearElement(elements.chainTimeline);

  if (
    state.selectedTerminalIndex == null ||
    !state.terminalMessages[state.selectedTerminalIndex]
  ) {
    elements.chainSummary.className = "chain-summary empty-note";
    elements.chainSummary.textContent =
      "选择终端消息之后，这里会展示当前消息生成过程中的 agent 行为链路。";
    return;
  }

  const currentTerminal = state.terminalMessages[state.selectedTerminalIndex];
  const previousTerminal =
    state.selectedTerminalIndex > 0
      ? state.terminalMessages[state.selectedTerminalIndex - 1]
      : null;

  const startRow = previousTerminal ? previousTerminal.rowIndex + 1 : 0;
  const chainEvents = state.selectedSessionEvents.filter(
    (event) =>
      event.__rowIndex >= startRow && event.__rowIndex <= currentTerminal.rowIndex,
  );
  const chainSteps = buildChainSteps(chainEvents);
  const summary = summarizeSteps(chainSteps);
  const lastUserStep = [...chainSteps].reverse().find((step) => step.kind === "user");

  elements.chainSummary.className = "chain-summary";

  const heading = document.createElement("h3");
  heading.textContent = `#${currentTerminal.ordinal} 的生成链路`;
  elements.chainSummary.appendChild(heading);

  const context = document.createElement("p");
  context.className = "chain-context";
  context.textContent = previousTerminal
    ? `区间：上一条终端消息 #${previousTerminal.ordinal} 之后，到当前终端消息 #${currentTerminal.ordinal} 为止。`
    : "区间：这是首条终端消息，链路从 session 开始处截取到当前终端消息。";
  elements.chainSummary.appendChild(context);

  const replyPreview = document.createElement("div");
  replyPreview.className = "reply-preview";
  replyPreview.textContent = currentTerminal.fullText;
  elements.chainSummary.appendChild(replyPreview);

  if (lastUserStep) {
    const userPrompt = document.createElement("p");
    userPrompt.className = "chain-context";
    userPrompt.textContent = `触发这次回复的最近一条用户消息：${previewText(
      lastUserStep.body,
      180,
    )}`;
    elements.chainSummary.appendChild(userPrompt);
  }

  const stats = document.createElement("div");
  stats.className = "summary-row";
  stats.appendChild(createSummaryPill(`user ${summary.user}`));
  stats.appendChild(createSummaryPill(`think ${summary.think}`));
  stats.appendChild(createSummaryPill(`toolCall ${summary.toolCall}`));
  stats.appendChild(createSummaryPill(`toolResult ${summary.toolResult}`));
  stats.appendChild(createSummaryPill(`reply ${summary.reply}`));
  if (summary.assistantError) {
    stats.appendChild(createSummaryPill(`error ${summary.assistantError}`));
  }
  elements.chainSummary.appendChild(stats);

  const tools = document.createElement("div");
  tools.className = "summary-row";
  if (summary.tools.size) {
    for (const toolName of summary.tools) {
      tools.appendChild(createBadge(`tool: ${toolName}`));
    }
  } else {
    tools.appendChild(createBadge("无 toolCall，属于纯文本链路"));
  }
  elements.chainSummary.appendChild(tools);

  if (!chainSteps.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "这段区间里没有可展示的 message 事件。";
    elements.chainTimeline.appendChild(empty);
    return;
  }

  for (const step of chainSteps) {
    const card = document.createElement("article");
    card.className = "timeline-card";
    card.dataset.kind = step.kind;
    if (step.isError) {
      card.classList.add("error");
    }

    const head = document.createElement("div");
    head.className = "timeline-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "timeline-title-wrap";

    const label = document.createElement("span");
    label.className = "timeline-label";
    label.textContent = step.label;
    titleWrap.appendChild(label);

    const title = document.createElement("h4");
    title.className = "timeline-title";
    title.textContent = step.title;
    titleWrap.appendChild(title);

    head.appendChild(titleWrap);

    const time = document.createElement("div");
    time.className = "timeline-time";
    time.textContent = formatAbsoluteTime(step.timestamp);
    head.appendChild(time);

    card.appendChild(head);

    const content = document.createElement("div");
    content.className = "timeline-content";
    appendExpandableContent(content, step.body);

    const meta = document.createElement("p");
    meta.className = "step-meta";
    meta.textContent = step.meta;
    content.appendChild(meta);

    card.appendChild(content);
    elements.chainTimeline.appendChild(card);
  }
}

async function selectSession(sessionKey) {
  const session = state.sessions.find((item) => item.key === sessionKey);
  if (!session) {
    return;
  }

  state.selectedSessionKey = sessionKey;
  state.selectedTerminalIndex = null;
  renderSessions();
  renderSessionMeta(session);
  renderTerminalMessages();
  renderChain();

  setStatus(`正在读取 ${session.sessionFile} ...`);

  try {
    let events = state.sessionCache.get(session.sessionId);
    if (!events) {
      const raw = await readTextAsset(session.sessionFile);
      events = parseJsonl(raw);
      state.sessionCache.set(session.sessionId, events);
    }

    state.selectedSessionEvents = events;
    state.terminalMessages = buildTerminalMessages(events);
    state.selectedTerminalIndex = state.terminalMessages.length
      ? state.terminalMessages.length - 1
      : null;

    renderSessionMeta(session);
    renderTerminalMessages();
    renderChain();

    setStatus(
      `已加载 ${session.sessionFile}，识别到 ${state.terminalMessages.length} 条终端消息。`,
    );
  } catch (error) {
    state.selectedSessionEvents = [];
    state.terminalMessages = [];
    state.selectedTerminalIndex = null;
    renderTerminalMessages();
    renderChain();
    setStatus(
      `读取 ${session.sessionFile} 失败：${error.message}。如果你是直接打开 HTML，请改用静态服务器，或点击“选择本地文件”手动导入。`,
      "error",
    );
  }
}

async function loadSessionsIndex() {
  setStatus("正在读取 sessions.json ...");

  try {
    const text = await readTextAsset("sessions.json");
    state.sessions = parseSessionsIndex(text);
    renderSessions();

    if (state.sessions.length) {
      await selectSession(state.sessions[0].key);
    } else {
      renderSessionMeta(null);
      renderTerminalMessages();
      renderChain();
      setStatus("sessions.json 已读取，但其中没有可展示的 session。", "warn");
    }
  } catch (error) {
    state.sessions = [];
    state.selectedSessionKey = null;
    state.selectedSessionEvents = [];
    state.terminalMessages = [];
    state.selectedTerminalIndex = null;
    renderSessions();
    renderSessionMeta(null);
    renderTerminalMessages();
    renderChain();
    setStatus(
      `自动读取 sessions.json 失败：${error.message}。如果你是通过 file:// 打开的页面，请点击“选择本地文件”导入 sessions.json 和对应 jsonl。`,
      "warn",
    );
  }
}

async function handleFileImport(event) {
  const files = Array.from(event.target.files || []);
  state.localFiles.clear();
  elements.fileInput.value = "";

  for (const file of files) {
    state.localFiles.set(file.name, file);
  }

  if (!state.localFiles.has("sessions.json")) {
    setStatus("手动导入时需要同时选择 sessions.json。", "warn");
    return;
  }

  state.sessionCache.clear();
  await loadSessionsIndex();
  setStatus(
    `已手动导入 ${files.length} 个文件。当前优先从你选择的本地文件中读取数据。`,
  );
}

elements.sessionSearch.addEventListener("input", (event) => {
  state.searchQuery = event.target.value || "";
  renderSessions();
});

elements.reloadButton.addEventListener("click", async () => {
  state.sessionCache.clear();
  await loadSessionsIndex();
});

elements.fileButton.addEventListener("click", () => {
  elements.fileInput.click();
});

elements.fileInput.addEventListener("change", handleFileImport);

loadSessionsIndex();
