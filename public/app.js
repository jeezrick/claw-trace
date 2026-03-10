const state = {
  sessions: [],
  searchQuery: "",
  selectedSessionKey: null,
  selectedSessionEvents: [],
  terminalMessages: [],
  selectedTerminalIndex: null,
  sessionCache: new Map(),
  localFiles: new Map(),
  sourceModalOpen: false,
  config: null,
  raw: {
    sourcePath: null,
    eventSource: null,
    connected: false,
    paused: false,
    filter: "",
    scope: "selected",
    selectedWindow: null,
    enabledKinds: new Set([
      "assistant_message_end",
      "assistant_thinking_stream",
      "toolCall",
      "toolResult",
      "error",
    ]),
    groups: [],
    maxGroups: 120,
    maxEventsPerGroup: 60,
    reconnectAttempt: 0,
  },
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
  themeButton: document.querySelector("#themeButton"),
  reloadButton: document.querySelector("#reloadButton"),
  fileButton: document.querySelector("#fileButton"),
  fileInput: document.querySelector("#fileInput"),
  sourceModal: document.querySelector("#sourceModal"),
  sourceModalContent: document.querySelector("#sourceModalContent"),
  sourceModalClose: document.querySelector("#sourceModalClose"),
  rawMeta: document.querySelector("#rawMeta"),
  rawStatus: document.querySelector("#rawStatus"),
  rawScope: document.querySelector("#rawScope"),
  rawFilter: document.querySelector("#rawFilter"),
  rawPauseButton: document.querySelector("#rawPauseButton"),
  rawClearButton: document.querySelector("#rawClearButton"),
  rawKindFilters: document.querySelector("#rawKindFilters"),
  rawEventList: document.querySelector("#rawEventList"),
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

const THEME_KEY = "claw-trace-theme";
const UI_STATE_KEY = "claw-trace-ui-state-v1";

function applyTheme(theme) {
  const target = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", target);
  if (elements.themeButton) {
    elements.themeButton.textContent =
      target === "light" ? "☀️ 浅色" : "🌙 深色";
  }
  try {
    localStorage.setItem(THEME_KEY, target);
  } catch (_) {
    // ignore storage errors
  }
}

function initTheme() {
  let preferred = "dark";
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      preferred = saved;
    } else if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    ) {
      preferred = "light";
    }
  } catch (_) {
    // ignore storage errors
  }
  applyTheme(preferred);
}

function setStatus(message, tone = "info") {
  elements.statusBar.dataset.tone = tone;
  elements.statusBar.textContent = message;
}

function saveUiState() {
  try {
    const payload = {
      selectedSessionKey: state.selectedSessionKey,
      searchQuery: state.searchQuery,
      rawScope: state.raw.scope,
      rawFilter: state.raw.filter,
      rawPaused: state.raw.paused,
      rawEnabledKinds: Array.from(state.raw.enabledKinds || []),
    };
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(payload));
  } catch (_) {
    // ignore storage errors
  }
}

function applyUiStateToControls() {
  if (elements.sessionSearch) {
    elements.sessionSearch.value = state.searchQuery || "";
  }
  if (elements.rawScope) {
    elements.rawScope.value = state.raw.scope || "selected";
  }
  if (elements.rawFilter) {
    elements.rawFilter.value = state.raw.filter || "";
  }
  if (elements.rawKindFilters) {
    const buttons = elements.rawKindFilters.querySelectorAll(".raw-kind-toggle");
    for (const btn of buttons) {
      const kind = btn.dataset.kind;
      if (!kind) continue;
      if (state.raw.enabledKinds.has(kind)) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
  }
}

function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    if (typeof parsed.searchQuery === "string") {
      state.searchQuery = parsed.searchQuery;
    }
    if (typeof parsed.selectedSessionKey === "string") {
      state.selectedSessionKey = parsed.selectedSessionKey;
    }
    if (parsed.rawScope === "selected" || parsed.rawScope === "all") {
      state.raw.scope = parsed.rawScope;
    }
    if (typeof parsed.rawFilter === "string") {
      state.raw.filter = parsed.rawFilter;
    }
    if (typeof parsed.rawPaused === "boolean") {
      state.raw.paused = parsed.rawPaused;
    }
    if (Array.isArray(parsed.rawEnabledKinds) && parsed.rawEnabledKinds.length) {
      state.raw.enabledKinds = new Set(parsed.rawEnabledKinds.map((v) => String(v)));
    }
  } catch (_) {
    // ignore malformed state
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function trimRawLine(line = "", maxLength = 280) {
  if (line.length <= maxLength) return line;
  return `${line.slice(0, Math.max(1, maxLength - 1))}…`;
}

function inferRawKind(entry) {
  const parsed = entry?.parsed;
  if (parsed && typeof parsed === "object") {
    if (parsed.event) return String(parsed.event);
    if (parsed.type) return String(parsed.type);
    if (parsed.kind) return String(parsed.kind);
  }

  const line = String(entry?.line || "").toLowerCase();
  if (line.includes("tool") && line.includes("call")) return "toolCall";
  if (line.includes("tool") && line.includes("result")) return "toolResult";
  if (line.includes("error")) return "error";
  if (line.includes("assistant")) return "assistant";
  if (line.includes("user")) return "user";
  return "event";
}

function isValuableRawEvent(entry) {
  const parsed = entry?.parsed;
  const kind = String(entry?.kind || "");

  // 太高频、噪音最大：默认不展示（可通过源文件查看）
  if (kind === "assistant_text_stream") {
    return false;
  }

  if (!parsed || typeof parsed !== "object") {
    return true;
  }

  const evtType = String(parsed.evtType || "");

  // thinking 仅保留阶段结束（避免逐 token 刷屏）
  if (kind === "assistant_thinking_stream") {
    return evtType === "thinking_end";
  }

  return true;
}

function rawPreviewText(entry) {
  const parsed = entry?.parsed;
  const kind = String(entry?.kind || "event");

  if (!parsed || typeof parsed !== "object") {
    return trimRawLine(String(entry?.line || ""));
  }

  if (kind === "assistant_message_end") {
    const text = String(parsed.rawText || "").replace(/\s+/g, " ").trim();
    return text ? `assistant end: ${trimRawLine(text, 220)}` : "assistant end";
  }

  if (kind === "assistant_thinking_stream") {
    const content = String(parsed.content || "").replace(/\s+/g, " ").trim();
    return content ? `thinking end: ${trimRawLine(content, 220)}` : "thinking end";
  }

  if (kind.includes("tool") || kind.includes("error")) {
    return trimRawLine(String(entry?.line || ""), 240);
  }

  return trimRawLine(String(entry?.line || ""), 220);
}

function currentSessionId() {
  const selected = state.sessions.find((s) => s.key === state.selectedSessionKey);
  return selected?.sessionId || null;
}

function parseTimestampMs(value) {
  if (!value) return null;
  const date = new Date(String(value));
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function currentSelectedWindow() {
  if (
    state.selectedTerminalIndex == null ||
    !state.terminalMessages[state.selectedTerminalIndex]
  ) {
    return null;
  }

  const currentTerminal = state.terminalMessages[state.selectedTerminalIndex];
  const previousTerminal =
    state.selectedTerminalIndex > 0
      ? state.terminalMessages[state.selectedTerminalIndex - 1]
      : null;

  const currentTs = parseTimestampMs(currentTerminal.timestamp);
  if (!currentTs) return null;

  // 窗口放宽，兼容 clock 偏差和流式事件先后
  const startTs = previousTerminal
    ? parseTimestampMs(previousTerminal.timestamp)
    : currentTs - 10 * 60 * 1000;

  return {
    startMs: (startTs || currentTs - 10 * 60 * 1000) - 30 * 1000,
    endMs: currentTs + 60 * 1000,
  };
}

function isNearBottom(el, threshold = 40) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function eventInSelectedWindow(entry) {
  const w = state.raw.selectedWindow;
  if (!w) return true;
  const ts = Number(entry?.ts || 0);
  return ts >= w.startMs && ts <= w.endMs;
}

function passesRawScope(group) {
  if (state.raw.scope === "all") return true;

  const sid = currentSessionId();
  const hasSessionScopedEvents = group.events.some((e) => e.sessionId && e.sessionId === sid);
  if (sid && hasSessionScopedEvents) return true;

  // raw-stream 常见只有 runId 没 sessionId，退化为“选中终端消息时间窗”匹配
  return group.events.some((e) => eventInSelectedWindow(e));
}

function entryKindEnabled(entry) {
  const kind = String(entry?.kind || "");
  return state.raw.enabledKinds.has(kind);
}

function groupMatchesQuery(group, query) {
  const visibleEvents = group.events.filter((entry) => entryKindEnabled(entry));
  if (!visibleEvents.length) return false;

  if (!query) return true;
  const headText = `${group.runId || ""} ${group.sessionId || ""}`.toLowerCase();
  if (headText.includes(query)) return true;
  return visibleEvents.some((entry) => `${entry.kind} ${entry.line}`.toLowerCase().includes(query));
}

function buildSelectedSessionActionHistory() {
  if (!state.selectedSessionEvents || !state.selectedSessionEvents.length) {
    return [];
  }

  const allowedKinds = new Set([
    "user",
    "think",
    "toolCall",
    "toolResult",
    "reply",
    "assistantError",
  ]);

  const steps = buildChainSteps(state.selectedSessionEvents).filter((step) =>
    allowedKinds.has(step.kind),
  );

  return steps.map((step) => ({
    kind: step.kind,
    label: step.label,
    title: step.title,
    body: step.body,
    meta: step.meta,
    isError: Boolean(step.isError),
    ts: parseTimestampMs(step.timestamp) || Date.now(),
  }));
}

function actionKindToRawKind(kind = "") {
  if (kind === "toolCall") return "toolCall";
  if (kind === "toolResult") return "toolResult";
  if (kind === "assistantError") return "error";
  if (kind === "reply") return "assistant_message_end";
  if (kind === "think") return "assistant_thinking_stream";
  return "user";
}

function detectActionHistoryStatus(actions) {
  if (!actions.length) return "暂无动作";
  const last = actions[actions.length - 1];
  if (last.kind === "reply") return "已完成";
  if (last.kind === "assistantError") return "执行失败";
  if (last.kind === "toolCall" || last.kind === "think") return "执行中";
  return "等待下一步";
}

function renderRawEvents() {
  if (!elements.rawEventList) return;

  const query = state.raw.filter.trim().toLowerCase();
  const shouldStickBottom = isNearBottom(elements.rawEventList);
  const previousScrollTop = elements.rawEventList.scrollTop;

  // selected 模式优先展示“当前 session 的 action 历史”（不依赖 raw-stream 实时性）
  if (state.raw.scope === "selected") {
    const actions = buildSelectedSessionActionHistory();
    const filteredActions = query
      ? actions.filter((a) => `${a.kind} ${a.title} ${a.body}`.toLowerCase().includes(query))
      : actions;

    elements.rawEventList.innerHTML = "";

    if (!filteredActions.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = query
        ? "当前 session 的 action 历史中没有匹配关键词的内容。"
        : "当前 session 暂无 action 历史。";
      elements.rawEventList.appendChild(empty);
      return;
    }

    const card = document.createElement("article");
    card.className = "raw-group";

    const head = document.createElement("div");
    head.className = "raw-group-head";

    const title = document.createElement("span");
    title.className = "raw-group-title";
    title.textContent = "当前 session action 历史";
    head.appendChild(title);

    const status = document.createElement("span");
    status.className = "raw-time";
    status.textContent = detectActionHistoryStatus(actions);
    head.appendChild(status);

    card.appendChild(head);

    for (const action of filteredActions) {
      const mappedKind = actionKindToRawKind(action.kind);
      if (!state.raw.enabledKinds.has(mappedKind)) continue;

      const item = document.createElement("article");
      item.className = "raw-item";
      if (action.isError) item.classList.add("error");

      const itemHead = document.createElement("div");
      itemHead.className = "raw-item-head";

      const kind = document.createElement("span");
      kind.className = "raw-kind";
      kind.textContent = mappedKind;
      itemHead.appendChild(kind);

      const itemTime = document.createElement("span");
      itemTime.className = "raw-time";
      itemTime.textContent = formatAbsoluteTime(action.ts);
      itemHead.appendChild(itemTime);

      item.appendChild(itemHead);

      const body = document.createElement("pre");
      body.className = "raw-line";
      body.textContent = `${action.title}\n${action.body}`;
      item.appendChild(body);

      card.appendChild(item);
    }

    elements.rawEventList.appendChild(card);
    if (shouldStickBottom && !state.raw.paused) {
      elements.rawEventList.scrollTop = elements.rawEventList.scrollHeight;
    } else {
      elements.rawEventList.scrollTop = Math.min(previousScrollTop, elements.rawEventList.scrollHeight);
    }
    return;
  }

  const groups = state.raw.groups.filter((group) => passesRawScope(group) && groupMatchesQuery(group, query));

  elements.rawEventList.innerHTML = "";

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = query
      ? "没有匹配当前过滤词的实时事件。"
      : "实时流还没有事件。确认网关已开启 raw-stream 并正在处理请求。";
    elements.rawEventList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  for (const group of groups) {
    const visibleEvents = group.events.filter((entry) => entryKindEnabled(entry));
    if (!visibleEvents.length) continue;

    const card = document.createElement("article");
    card.className = "raw-group";

    const head = document.createElement("div");
    head.className = "raw-group-head";

    const title = document.createElement("span");
    title.className = "raw-group-title";
    title.textContent = `run ${truncateMiddle(group.runId || "-", 24)} · session ${truncateMiddle(group.sessionId || "-", 28)}`;
    head.appendChild(title);

    const time = document.createElement("span");
    time.className = "raw-time";
    time.textContent = formatAbsoluteTime(group.updatedAt);
    head.appendChild(time);

    card.appendChild(head);

    for (const entry of visibleEvents) {
      const item = document.createElement("article");
      item.className = "raw-item";

      const itemHead = document.createElement("div");
      itemHead.className = "raw-item-head";

      const kind = document.createElement("span");
      kind.className = "raw-kind";
      kind.textContent = entry.kind;
      itemHead.appendChild(kind);

      const itemTime = document.createElement("span");
      itemTime.className = "raw-time";
      itemTime.textContent = formatAbsoluteTime(entry.ts);
      itemHead.appendChild(itemTime);

      item.appendChild(itemHead);

      const body = document.createElement("pre");
      body.className = "raw-line";
      body.textContent = rawPreviewText(entry);
      item.appendChild(body);

      card.appendChild(item);
    }

    frag.appendChild(card);
  }

  elements.rawEventList.appendChild(frag);
  if (shouldStickBottom && !state.raw.paused) {
    elements.rawEventList.scrollTop = elements.rawEventList.scrollHeight;
  } else {
    elements.rawEventList.scrollTop = Math.min(previousScrollTop, elements.rawEventList.scrollHeight);
  }
}

function updateRawHeader() {
  if (!elements.rawStatus) return;
  elements.rawStatus.textContent = state.raw.connected
    ? state.raw.paused
      ? "已连接（暂停中）"
      : "已连接（实时）"
    : "未连接";

  if (elements.rawPauseButton) {
    elements.rawPauseButton.textContent = state.raw.paused ? "继续" : "暂停";
  }

  if (elements.rawMeta) {
    elements.rawMeta.textContent = state.raw.sourcePath
      ? `源文件：${state.raw.sourcePath}`
      : "源文件：未知";
  }
}

function getRawGroupKey(entry) {
  const parsed = entry?.parsed;
  if (!parsed || typeof parsed !== "object") {
    return "ungrouped";
  }
  return `${parsed.runId || "-"}::${parsed.sessionId || "-"}`;
}

function pushRawEvent(entry) {
  const normalized = {
    ts: Number(entry?.ts || Date.now()),
    line: String(entry?.line || ""),
    parsed: entry?.parsed ?? null,
    runId: null,
    sessionId: null,
  };
  normalized.kind = inferRawKind(normalized);

  if (!isValuableRawEvent(normalized)) {
    return;
  }

  const parsed = normalized.parsed && typeof normalized.parsed === "object" ? normalized.parsed : {};
  normalized.runId = parsed.runId || null;
  normalized.sessionId = parsed.sessionId || null;

  const key = getRawGroupKey(normalized);

  let group = state.raw.groups.find((g) => g.key === key);
  if (!group) {
    group = {
      key,
      runId: parsed.runId || null,
      sessionId: parsed.sessionId || null,
      updatedAt: normalized.ts,
      events: [],
    };
    state.raw.groups.push(group);
  }

  group.updatedAt = normalized.ts;
  group.events.push(normalized);
  if (group.events.length > state.raw.maxEventsPerGroup) {
    group.events.splice(0, group.events.length - state.raw.maxEventsPerGroup);
  }

  state.raw.groups.sort((a, b) => b.updatedAt - a.updatedAt);
  if (state.raw.groups.length > state.raw.maxGroups) {
    state.raw.groups.splice(state.raw.maxGroups);
  }

  if (!state.raw.paused) {
    renderRawEvents();
  }
}

async function loadConfig() {
  try {
    const resp = await fetch("/api/config", { cache: "no-store" });
    if (!resp.ok) throw new Error(`读取 /api/config 失败（${resp.status}）`);
    state.config = await resp.json();
    state.raw.sourcePath = state.config.rawStreamFile || null;
    updateRawHeader();
  } catch (error) {
    setStatus(`读取服务配置失败：${error.message}`, "warn");
  }
}

function connectRawStream() {
  if (!window.EventSource) {
    setStatus("浏览器不支持 EventSource，无法显示实时 raw stream。", "warn");
    return;
  }

  if (state.raw.eventSource) {
    try {
      state.raw.eventSource.close();
    } catch (_) {
      // ignore
    }
    state.raw.eventSource = null;
  }

  const source = new EventSource("/api/raw-stream?replay=2000");
  state.raw.eventSource = source;

  source.addEventListener("open", () => {
    state.raw.connected = true;
    state.raw.reconnectAttempt = 0;
    updateRawHeader();
  });

  source.addEventListener("meta", (event) => {
    try {
      const payload = JSON.parse(event.data || "{}");
      if (payload.rawStreamFile) {
        state.raw.sourcePath = payload.rawStreamFile;
      }
      updateRawHeader();
    } catch (_) {
      // ignore
    }
  });

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data || "{}");
      pushRawEvent(payload);
    } catch (_) {
      // ignore malformed chunks
    }
  };

  source.onerror = () => {
    state.raw.connected = false;
    updateRawHeader();

    try {
      source.close();
    } catch (_) {
      // ignore
    }

    state.raw.reconnectAttempt = (state.raw.reconnectAttempt || 0) + 1;
    const backoff = Math.min(12000, 1200 * state.raw.reconnectAttempt);

    window.setTimeout(() => {
      if (!state.raw.connected) {
        connectRawStream();
      }
    }, backoff);
  };
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
  const terminals = events
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
        pending: false,
      };
    });

  const lastTerminalRow = terminals.length
    ? terminals[terminals.length - 1].rowIndex
    : -1;

  const tailEvents = events.filter((event) => event.__rowIndex > lastTerminalRow);
  const tailUsers = tailEvents.filter(
    (event) => event?.type === "message" && event?.message?.role === "user",
  );

  if (tailUsers.length) {
    const pendingUser = tailUsers[tailUsers.length - 1];
    const userText = normalizeUserText(
      extractTextContent(pendingUser.message?.content || []),
    );

    terminals.push({
      ordinal: terminals.length + 1,
      rowIndex: pendingUser.__rowIndex,
      id: pendingUser.id,
      timestamp: pendingUser.timestamp,
      preview: previewText(userText || "(空文本)"),
      fullText: userText || "(空文本)",
      event: pendingUser,
      pending: true,
    });
  }

  return terminals;
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
        raw: event,
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
          raw: event,
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
            raw: { event, item },
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
            raw: { event, item },
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
            raw: { event, item },
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
          raw: { event, item },
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
          raw: event,
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
        raw: event,
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

function openSourceModal(raw, title = "源码") {
  if (!elements.sourceModal || !elements.sourceModalContent) {
    return;
  }
  const text =
    typeof raw === "string"
      ? raw
      : (() => {
          try {
            return JSON.stringify(raw, null, 2);
          } catch (_) {
            return String(raw);
          }
        })();

  elements.sourceModalContent.textContent = text;
  const titleEl = document.querySelector("#sourceModalTitle");
  if (titleEl) {
    titleEl.textContent = title;
  }
  elements.sourceModal.classList.remove("hidden");
  state.sourceModalOpen = true;
}

function closeSourceModal() {
  if (!elements.sourceModal || !elements.sourceModalContent) {
    return;
  }
  elements.sourceModal.classList.add("hidden");
  elements.sourceModalContent.textContent = "";
  state.sourceModalOpen = false;
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
    empty.textContent = "这个 session 里还没有可展示的终端消息。";
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
    title.textContent = terminal.pending
      ? `#${terminal.ordinal} · 未回复消息：${terminal.preview}`
      : `#${terminal.ordinal} · ${terminal.preview}`;
    button.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "list-card-meta";
    meta.textContent = terminal.pending
      ? `${formatAbsoluteTime(terminal.timestamp)} · row ${terminal.rowIndex} · pending`
      : `${formatAbsoluteTime(terminal.timestamp)} · row ${terminal.rowIndex}`;
    button.appendChild(meta);

    if (terminal.pending) {
      const pendingBadge = document.createElement("span");
      pendingBadge.className = "pending-badge";
      pendingBadge.textContent = "待回复";
      button.appendChild(pendingBadge);
    }

    const preview = document.createElement("p");
    preview.className = "list-card-preview";
    preview.textContent = terminal.fullText;
    button.appendChild(preview);

    button.addEventListener("click", () => {
      state.selectedTerminalIndex = index;
      state.raw.selectedWindow = currentSelectedWindow();
      renderTerminalMessages();
      renderChain();
      renderRawEvents();
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
  heading.textContent = currentTerminal.pending
    ? `#${currentTerminal.ordinal} 的待回复链路`
    : `#${currentTerminal.ordinal} 的生成链路`;
  elements.chainSummary.appendChild(heading);

  const context = document.createElement("p");
  context.className = "chain-context";
  if (currentTerminal.pending) {
    context.textContent = previousTerminal
      ? `区间：上一条终端消息 #${previousTerminal.ordinal} 之后，到最近一条用户消息为止（当前还未生成 assistant 终端回复）。`
      : "区间：从 session 开始到最近一条用户消息为止（当前还未生成 assistant 终端回复）。";
  } else {
    context.textContent = previousTerminal
      ? `区间：上一条终端消息 #${previousTerminal.ordinal} 之后，到当前终端消息 #${currentTerminal.ordinal} 为止。`
      : "区间：这是首条终端消息，链路从 session 开始处截取到当前终端消息。";
  }
  elements.chainSummary.appendChild(context);

  const replyPreview = document.createElement("div");
  replyPreview.className = "reply-preview";
  replyPreview.textContent = currentTerminal.pending
    ? `未回复用户消息：${currentTerminal.fullText}`
    : currentTerminal.fullText;
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

    const sourceButton = document.createElement("button");
    sourceButton.type = "button";
    sourceButton.className = "source-button";
    sourceButton.textContent = "查看源码";
    sourceButton.addEventListener("click", () => {
      openSourceModal(step.raw || step.body || "", `${step.label} · ${step.title}`);
    });
    content.appendChild(sourceButton);

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
  state.raw.selectedWindow = null;
  saveUiState();
  renderSessions();
  renderSessionMeta(session);
  renderTerminalMessages();
  renderChain();
  renderRawEvents();

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

    state.raw.selectedWindow = currentSelectedWindow();

    renderSessionMeta(session);
    renderTerminalMessages();
    renderChain();
    renderRawEvents();

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
      const preferred =
        state.selectedSessionKey &&
        state.sessions.some((s) => s.key === state.selectedSessionKey)
          ? state.selectedSessionKey
          : state.sessions[0].key;
      await selectSession(preferred);
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
  saveUiState();
  renderSessions();
});

if (elements.themeButton) {
  elements.themeButton.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

elements.reloadButton.addEventListener("click", async () => {
  state.sessionCache.clear();
  await loadSessionsIndex();
});

elements.fileButton.addEventListener("click", () => {
  elements.fileInput.click();
});

elements.fileInput.addEventListener("change", handleFileImport);

if (elements.rawKindFilters) {
  elements.rawKindFilters.addEventListener("click", (event) => {
    const button = event.target.closest(".raw-kind-toggle");
    if (!button) return;

    const kind = button.dataset.kind;
    if (!kind) return;

    if (state.raw.enabledKinds.has(kind)) {
      state.raw.enabledKinds.delete(kind);
      button.classList.remove("active");
    } else {
      state.raw.enabledKinds.add(kind);
      button.classList.add("active");
    }

    saveUiState();
    renderRawEvents();
  });
}

if (elements.rawScope) {
  elements.rawScope.addEventListener("change", (event) => {
    state.raw.scope = event.target.value || "selected";
    saveUiState();
    renderRawEvents();
  });
}

if (elements.rawFilter) {
  elements.rawFilter.addEventListener("input", (event) => {
    state.raw.filter = event.target.value || "";
    saveUiState();
    renderRawEvents();
  });
}

if (elements.rawPauseButton) {
  elements.rawPauseButton.addEventListener("click", () => {
    state.raw.paused = !state.raw.paused;
    saveUiState();
    updateRawHeader();
    if (!state.raw.paused) {
      renderRawEvents();
    }
  });
}

if (elements.rawClearButton) {
  elements.rawClearButton.addEventListener("click", () => {
    state.raw.groups = [];
    renderRawEvents();
  });
}

if (elements.sourceModalClose) {
  elements.sourceModalClose.addEventListener("click", closeSourceModal);
}

if (elements.sourceModal) {
  elements.sourceModal.addEventListener("click", (event) => {
    if (event.target === elements.sourceModal) {
      closeSourceModal();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.sourceModalOpen) {
    closeSourceModal();
  }
});

initTheme();
loadUiState();
applyUiStateToControls();
updateRawHeader();
renderRawEvents();
loadConfig();
connectRawStream();
loadSessionsIndex();
window.setInterval(loadSessionsIndex, 15000);
