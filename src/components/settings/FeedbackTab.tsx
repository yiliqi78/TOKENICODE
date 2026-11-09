/**
 * FeedbackTab — dedicated "反馈" tab in the settings panel.
 *
 * Collects free-text feedback + optional contact + optional screenshot,
 * bundles diagnostic metadata (app version, provider, model, session id,
 * locale) and ships to Feishu via the self-built app webhook in Rust.
 *
 * Disabled when FEISHU_* env vars weren't baked in at build time.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge, type DiagnosticsMeta, type FeedbackMetadata } from '../../lib/tauri-bridge';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore } from '../../stores/chatStore';
import { useSetupStore } from '../../stores/setupStore';
import { useT } from '../../lib/i18n';
import { APP_NAME } from '../../lib/edition';

type SubmitState = 'idle' | 'sending' | 'success' | 'error';
type ExportState =
  | { kind: 'idle' }
  | { kind: 'exporting' }
  | { kind: 'done'; path: string; bytes: number }
  | { kind: 'error'; message: string };

/** 当前 Provider / 模型 / 最近一个 CLI 会话 id——反馈卡片和诊断包共用。 */
function collectContext() {
  const activeProviderId = useProviderStore.getState().activeProviderId;
  const providers = useProviderStore.getState().providers;
  const provider = activeProviderId
    ? providers.find((p) => p.id === activeProviderId)
    : undefined;
  const selectedTabId = useSessionStore.getState().selectedSessionId;
  const sessionMeta = selectedTabId
    ? useChatStore.getState().getTab(selectedTabId)?.sessionMeta
    : undefined;
  const fallbackSessionId = sessionMeta?.sessionId && !sessionMeta.sessionId.startsWith('desk_')
    ? sessionMeta.sessionId
    : undefined;
  const sessionId =
    (selectedTabId
      ? useSessionStore.getState().sessions.find((s) => s.id === selectedTabId)?.cliResumeId
      : null) ?? fallbackSessionId;
  return {
    provider,
    model: useSettingsStore.getState().selectedModel,
    sessionId,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FeedbackTab() {
  const t = useT();
  const locale = useSettingsStore((s) => s.locale);
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [screenshot, setScreenshot] = useState<{ dataUrl: string; base64: string } | null>(null);
  const [state, setState] = useState<SubmitState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [logDir, setLogDir] = useState('');
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bridge.feedbackIsConfigured().then(setConfigured).catch(() => setConfigured(false));
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion().then(setAppVersion))
      .catch(() => {});
    bridge.getLogDir().then(setLogDir).catch(() => {});
  }, []);

  const handleOpenLogDir = useCallback(async () => {
    try {
      const dir = await bridge.openLogDir();
      setLogDir(dir);
    } catch (err) {
      setExportState({ kind: 'error', message: String(err) });
    }
  }, []);

  const handleExportDiagnostics = useCallback(async () => {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const dest = await save({
      defaultPath: `${APP_NAME.toLowerCase()}-diagnostics-${stamp}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (!dest) return;
    setExportState({ kind: 'exporting' });

    const ctx = collectContext();
    // CLI 版本优先用设置页刚检测到的，没有就现查一次（best-effort）
    let cliVersion = useSetupStore.getState().cliVersion ?? undefined;
    let cliPath = useSetupStore.getState().cliPath ?? undefined;
    if (!cliVersion) {
      try {
        const status = await bridge.checkClaudeCli();
        cliVersion = status.version ?? undefined;
        cliPath = status.path ?? undefined;
      } catch {
        // ignore
      }
    }
    const meta: DiagnosticsMeta = {
      app_name: APP_NAME,
      app_version: appVersion || 'unknown',
      locale,
      provider_name: ctx.provider?.name,
      provider_preset: ctx.provider?.preset,
      provider_api_format: ctx.provider?.apiFormat,
      provider_base_url: ctx.provider?.baseUrl,
      model: ctx.model,
      session_id: ctx.sessionId,
      cli_version: cliVersion,
      cli_path: cliPath,
    };
    try {
      const result = await bridge.exportDiagnostics(dest, meta);
      setExportState({ kind: 'done', path: result.path, bytes: result.bytes });
    } catch (err) {
      setExportState({ kind: 'error', message: String(err) });
    }
  }, [appVersion, locale]);

  const readImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg(t('feedback.imageOnly'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg(t('feedback.imageTooLarge'));
      return;
    }
    setErrorMsg('');
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const dataUrl = `data:${file.type};base64,${base64}`;
    setScreenshot({ dataUrl, base64 });
  }, [t]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await readImageFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [readImageFile]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await readImageFile(file);
          break;
        }
      }
    }
  }, [readImageFile]);

  const handleSubmit = useCallback(async () => {
    if (!description.trim()) {
      setErrorMsg(t('feedback.emptyDescription'));
      return;
    }
    setState('sending');
    setErrorMsg('');

    const ctx = collectContext();
    const metadata: FeedbackMetadata = {
      app_name: APP_NAME,
      app_version: appVersion || 'unknown',
      locale,
      provider_name: ctx.provider?.name,
      model: ctx.model,
      session_id: ctx.sessionId,
      user_contact: contact.trim() || undefined,
    };

    try {
      await bridge.submitFeedback({
        description: description.trim(),
        screenshotBase64: screenshot?.base64,
        metadata,
      });
      setState('success');
      setDescription('');
      setContact('');
      setScreenshot(null);
      setTimeout(() => setState('idle'), 4000);
    } catch (err) {
      setErrorMsg(String(err));
      setState('error');
    }
  }, [description, contact, screenshot, appVersion, locale, t]);

  const isDisabled = state === 'sending' || configured === false;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-[13px] font-medium text-text-primary mb-2">
          {t('feedback.title')}
        </h3>
        <p className="text-xs text-text-tertiary leading-relaxed">
          {t('feedback.subtitle')}
        </p>
      </div>

      {/* Not-configured warning */}
      {configured === false && (
        <div className="py-2 px-3 rounded-lg bg-amber-500/10">
          <p className="text-[13px] text-amber-500 font-medium">
            {t('feedback.notConfigured')}
          </p>
        </div>
      )}

      {/* Description */}
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-primary block">
          {t('feedback.descriptionLabel')}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onPaste={handlePaste}
          placeholder={t('feedback.descriptionPlaceholder')}
          rows={5}
          maxLength={5000}
          disabled={isDisabled}
          className="w-full px-3 py-2 rounded-lg border border-border-subtle
            bg-bg-secondary text-[13px] text-text-primary placeholder:text-text-tertiary
            focus:outline-none focus:border-accent/60 transition-smooth resize-none
            disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">{t('feedback.pasteHint')}</span>
          <span className="text-xs text-text-tertiary">{description.length} / 5000</span>
        </div>
      </div>

      {/* Screenshot */}
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-primary block">
          {t('feedback.screenshotLabel')}
        </label>
        {screenshot ? (
          <div className="relative inline-block">
            <img
              src={screenshot.dataUrl}
              alt="screenshot"
              className="max-h-40 rounded-lg border border-border-subtle"
            />
            <button
              onClick={() => setScreenshot(null)}
              disabled={isDisabled}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-bg-card
                border border-border-subtle text-text-muted hover:text-text-primary
                flex items-center justify-center shadow-sm transition-smooth
                disabled:opacity-50 disabled:cursor-not-allowed"
              title={t('feedback.removeScreenshot')}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={handleFileSelect}
            disabled={isDisabled}
            className="w-full py-2 text-[13px] font-medium rounded-lg
              border border-dashed border-border-subtle text-text-muted
              hover:bg-bg-secondary hover:text-text-primary transition-smooth
              disabled:opacity-50 disabled:cursor-not-allowed
              inline-flex items-center justify-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            {t('feedback.addScreenshot')}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Contact */}
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-primary block">
          {t('feedback.contactLabel')}
        </label>
        <input
          type="text"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          disabled={isDisabled}
          placeholder={t('feedback.contactPlaceholder')}
          maxLength={100}
          className="w-full px-3 py-2 rounded-lg border border-border-subtle
            bg-bg-secondary text-[13px] text-text-primary placeholder:text-text-tertiary
            focus:outline-none focus:border-accent/60 transition-smooth
            disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Error / success */}
      {errorMsg && state === 'error' && (
        <div className="py-2 px-3 rounded-lg bg-red-500/10">
          <p className="text-[13px] text-red-500 break-words">{errorMsg}</p>
        </div>
      )}
      {state === 'success' && (
        <div className="py-2 px-3 rounded-lg bg-green-500/10">
          <p className="text-[13px] text-green-500 font-medium">
            ✓ {t('feedback.successMessage')}
          </p>
        </div>
      )}

      {/* Submit button (primary, full-width to match CliTab install button) */}
      <button
        onClick={handleSubmit}
        disabled={isDisabled || !description.trim()}
        className={`w-full py-2 text-[13px] font-medium rounded-lg transition-smooth
          inline-flex items-center justify-center gap-2
          ${isDisabled || !description.trim()
            ? 'border border-border-subtle text-text-tertiary cursor-not-allowed'
            : 'bg-accent text-text-inverse hover:bg-accent-hover'
          }`}
      >
        {state === 'sending' && (
          <span className="w-3 h-3 border-[1.5px] border-text-inverse/30
            border-t-text-inverse rounded-full animate-spin" />
        )}
        {state === 'sending' ? t('feedback.sending') : t('feedback.submit')}
      </button>

      {/* Logs & diagnostics */}
      <div className="pt-4 border-t border-border-subtle space-y-3">
        <div>
          <h3 className="text-[13px] font-medium text-text-primary mb-2">
            {t('feedback.diag.title')}
          </h3>
          <p className="text-xs text-text-tertiary leading-relaxed">
            {t('feedback.diag.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleOpenLogDir}
            className="flex-1 py-2 text-[13px] font-medium rounded-lg
              border border-border-subtle text-text-muted
              hover:bg-bg-secondary hover:text-text-primary transition-smooth"
          >
            {t('feedback.diag.openLogDir')}
          </button>
          <button
            onClick={handleExportDiagnostics}
            disabled={exportState.kind === 'exporting'}
            className="flex-1 py-2 text-[13px] font-medium rounded-lg
              border border-border-subtle text-text-muted
              hover:bg-bg-secondary hover:text-text-primary transition-smooth
              disabled:opacity-50 disabled:cursor-not-allowed
              inline-flex items-center justify-center gap-2"
          >
            {exportState.kind === 'exporting' && (
              <span className="w-3 h-3 border-[1.5px] border-text-muted/30
                border-t-text-muted rounded-full animate-spin" />
            )}
            {exportState.kind === 'exporting' ? t('feedback.diag.exporting') : t('feedback.diag.export')}
          </button>
        </div>
        <p className="text-xs text-text-tertiary leading-relaxed">
          {t('feedback.diag.contents')}
        </p>
        {logDir && (
          <p className="text-xs text-text-tertiary break-all">
            {t('feedback.diag.logDir')}: <span className="font-mono">{logDir}</span>
          </p>
        )}
        {exportState.kind === 'done' && (
          <div className="py-2 px-3 rounded-lg bg-green-500/10 space-y-1">
            <p className="text-[13px] text-green-500 font-medium">
              ✓ {t('feedback.diag.exported')} · {formatBytes(exportState.bytes)}
            </p>
            <p className="text-xs text-text-tertiary break-all font-mono">{exportState.path}</p>
            <button
              onClick={() => bridge.revealInFinder(exportState.path).catch(() => {})}
              className="text-xs text-accent hover:underline"
            >
              {t('feedback.diag.reveal')}
            </button>
          </div>
        )}
        {exportState.kind === 'error' && (
          <div className="py-2 px-3 rounded-lg bg-red-500/10">
            <p className="text-[13px] text-red-500 break-words">
              {t('feedback.diag.exportFailed')}: {exportState.message}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
