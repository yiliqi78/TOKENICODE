import type { ChatMessage } from '../stores/chatStore';
import { generateMessageId } from '../stores/chatStore';
import type { AgentPhase } from '../stores/agentStore';

export interface AgentData {
  id: string;
  parentId: string | null;
  description: string;
  phase: AgentPhase;
  startTime: number;
  endTime: number;
  isMain: boolean;
}

export interface LoadedSession {
  messages: ChatMessage[];
  agents: AgentData[];
  mainAgentStartTime: number;
}

/** Detect system-injected content that should not be shown to users */
function isSystemText(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('<')                            // XML tags like <system-reminder>
    || t.startsWith('This session is being continued') // continuation summaries
    || /^Analysis:\s*\n/.test(t)                       // continuation analysis blocks
    || /^Summary:\s*\n/.test(t)                        // continuation summary blocks
    || t.startsWith('In this environment you have access to') // tool definitions
    || t.startsWith('Human:')                          // raw conversation format leaks
    || t.includes('<system-reminder>')                 // embedded system reminders
    || t.includes('</system-reminder>');
}

/** Parse raw JSONL messages into structured session data */
export function parseSessionMessages(rawMessages: any[]): LoadedSession {
  const messages: ChatMessage[] = [];
  const agents: AgentData[] = [];

  // Create main agent with session start time
  const firstMsg = rawMessages[0];
  const sessionStartTime = firstMsg?.timestamp
    ? new Date(firstMsg.timestamp).getTime()
    : Date.now();

  agents.push({
    id: 'main',
    parentId: null,
    description: 'Main',
    phase: 'completed',
    startTime: sessionStartTime,
    endTime: Date.now(),
    isMain: true,
  });

  // Collect tool_use_id → index mapping for binding tool results
  const toolUseIdToIndex = new Map<string, number>();

  const extractToolResultText = (payload: any): string => {
    if (typeof payload === 'string') return payload;
    if (Array.isArray(payload)) {
      return payload.map((item: any) => item?.text || item?.content || '').join('');
    }
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.stdout === 'string') return payload.stdout;
    if (typeof payload.output === 'string') return payload.output;
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.content === 'string') return payload.content;
    if (Array.isArray(payload.content)) {
      return payload.content.map((item: any) => item?.text || item?.content || '').join('');
    }
    if (payload.content && typeof payload.content === 'object' && 'text' in payload.content) {
      return String(payload.content.text ?? '');
    }
    return '';
  };

  const bindToolResult = (toolUseId: string | undefined, resultText: string) => {
    if (!toolUseId) return;
    const idx = toolUseIdToIndex.get(toolUseId);
    if (idx === undefined || !messages[idx]) return;
    messages[idx] = {
      ...messages[idx],
      toolCompleted: true,
      ...(resultText ? { toolResultContent: resultText } : {}),
    };
  };

  for (const msg of rawMessages) {
    // Skip system-injected meta messages
    if (msg.isMeta) continue;

    const hasTopLevelToolUseResult = Object.prototype.hasOwnProperty.call(msg, 'tool_use_result')
      || Object.prototype.hasOwnProperty.call(msg, 'toolUseResult');
    const hasTopLevelToolResult = Object.prototype.hasOwnProperty.call(msg, 'tool_result')
      || Object.prototype.hasOwnProperty.call(msg, 'toolResult');

    // Handle tool_result messages: attach result to parent tool_use card
    if (hasTopLevelToolUseResult || hasTopLevelToolResult || msg.type === 'tool_result') {
      const blocks = Array.isArray(msg.message?.content)
        ? msg.message.content
        : Array.isArray(msg.content)
          ? msg.content
          : [];
      const topLevelToolUseResult = hasTopLevelToolUseResult
        ? (msg.tool_use_result ?? msg.toolUseResult)
        : undefined;
      const topLevelToolResult = hasTopLevelToolResult
        ? (msg.tool_result ?? msg.toolResult)
        : undefined;
      const topLevelResultText = extractToolResultText(
        hasTopLevelToolUseResult ? topLevelToolUseResult : topLevelToolResult,
      );
      for (const b of blocks) {
        if (b?.tool_use_id && (b?.type === 'tool_result' || hasTopLevelToolUseResult || hasTopLevelToolResult)) {
          bindToolResult(
            b.tool_use_id,
            (hasTopLevelToolUseResult || hasTopLevelToolResult)
              ? topLevelResultText
              : extractToolResultText(b.content ?? b.output),
          );
        }
      }
      if (msg.type === 'tool_result') {
        bindToolResult(msg.tool_use_id, extractToolResultText(msg.content ?? msg.output));
      } else if (hasTopLevelToolUseResult || hasTopLevelToolResult) {
        bindToolResult(msg.tool_use_id ?? msg.toolUseId, topLevelResultText);
      }
      continue;
    }

    if (msg.type === 'human' || msg.type === 'user' || msg.role === 'user') {
      // Extract text blocks, filtering out system-injected content
      const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
      const userTexts: string[] = [];
      for (const b of blocks) {
        const text = typeof b === 'string' ? b : b?.type === 'text' ? b.text : '';
        if (text && !isSystemText(text)) userTexts.push(text);
      }
      // Fallback for plain string content
      if (blocks.length === 0 && typeof msg.message?.content === 'string') {
        const text = msg.message.content;
        if (!isSystemText(text)) userTexts.push(text);
      }
      let content = userTexts.join('');
      // Extract file attachments from text
      const attachments: Array<{ name: string; path: string; isImage: boolean }> = [];
      const attachRegex = /\n?\n?\[(?:附加的文件|Attached files)\]\n([\s\S]+)$/;
      const attachMatch = content.match(attachRegex);
      if (attachMatch) {
        content = content.slice(0, attachMatch.index!).trimEnd();
        const paths = attachMatch[1].split('\n').map(p => p.trim()).filter(Boolean);
        for (const p of paths) {
          const name = p.split(/[\\/]/).pop() || p;
          const ext = name.split('.').pop()?.toLowerCase() || '';
          const isImage = ['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext);
          attachments.push({ name, path: p, isImage });
        }
      }
      if (content.trim()) {
        messages.push({
          id: msg.uuid || generateMessageId(),
          role: 'user',
          type: 'text',
          content,
          timestamp: msg.timestamp || Date.now(),
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      }
    } else if (msg.type === 'assistant') {
      const blocks = msg.message?.content;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block.type === 'text') {
            if (isSystemText(block.text || '')) continue;
            messages.push({
              id: msg.uuid || generateMessageId(),
              role: 'assistant',
              type: 'text',
              content: block.text,
              timestamp: msg.timestamp || Date.now(),
            });
          } else if (block.type === 'tool_use') {
            // Rebuild agent tree from Agent/Task tool_use blocks
            if (block.name === 'Task' || block.name === 'Agent') {
              agents.push({
                id: block.id || generateMessageId(),
                parentId: 'main',
                description: block.input?.description || block.input?.prompt || 'Agent',
                phase: 'completed',
                startTime: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                endTime: Date.now(),
                isMain: false,
              });
            }

            let chatMsg: ChatMessage;
            if (block.name === 'AskUserQuestion' && block.input?.questions) {
              chatMsg = {
                id: block.id || generateMessageId(),
                role: 'assistant',
                type: 'question',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                questions: block.input.questions,
                resolved: true,
                timestamp: msg.timestamp || Date.now(),
              };
            } else if (block.name === 'TodoWrite' && block.input?.todos) {
              chatMsg = {
                id: block.id || generateMessageId(),
                role: 'assistant',
                type: 'todo',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                todoItems: block.input.todos,
                timestamp: msg.timestamp || Date.now(),
              };
            } else {
              chatMsg = {
                id: block.id || generateMessageId(),
                role: 'assistant',
                type: 'tool_use',
                content: '',
                toolName: block.name,
                toolInput: block.input,
                timestamp: msg.timestamp || Date.now(),
              };
            }
            // Record tool_use_id for later result binding
            if (block.id) {
              toolUseIdToIndex.set(block.id, messages.length);
            }
            messages.push(chatMsg);
          } else if (block.type === 'tool_result') {
            const resultText = Array.isArray(block.content)
              ? block.content.map((b: any) => b.text || b.content || '').join('')
              : typeof block.content === 'string'
                ? block.content
                : block.output || '';
            if (block.tool_use_id) {
              const idx = toolUseIdToIndex.get(block.tool_use_id);
              if (idx !== undefined && messages[idx]) {
                messages[idx] = {
                  ...messages[idx],
                  toolCompleted: true,
                  ...(resultText ? { toolResultContent: resultText } : {}),
                };
              }
            }
          } else if (block.type === 'thinking') {
            messages.push({
              id: generateMessageId(),
              role: 'assistant',
              type: 'thinking',
              content: block.thinking || '',
              timestamp: msg.timestamp || Date.now(),
            });
          }
        }
      }
    }
  }

  return { messages, agents, mainAgentStartTime: sessionStartTime };
}
