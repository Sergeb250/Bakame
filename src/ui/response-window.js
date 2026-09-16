/* A single capture-protected conversation for typed prompts, screenshots and live speech. */
document.addEventListener('DOMContentLoaded', () => {
  const api = window.electronAPI;
  const el = id => document.getElementById(id);
  const historyKey = 'opencluely_chat_history_v1';
  const turns = new Map();
  const discarded = new Set();
  let available = false, recording = false, processing = false, changingCapture = false;
  let interactive = true, sending = false, speechError = false, skillCatalog = [];
  let localSequence = 0, restoring = false;
  const transcript = el('interimOverlay');

  function notice(message = '') {
    el('assistantError').textContent = message;
    el('assistantError').hidden = !message;
  }
  function persist() {
    if (restoring) return;
    try {
      const records = [...turns.values()].slice(-200).map(({ id, prompt, source, skill, text, done, error }) =>
        ({ kind: 'turn', id, prompt, source, skill, text, done, error }));
      localStorage.setItem(historyKey, JSON.stringify(records));
    } catch (_) { notice('Conversation history could not be saved on this device.'); }
  }
  function followScroll(work, force = false) {
    const scroller = el('conversation');
    const follow = force || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
    work();
    if (follow) scroller.scrollTop = scroller.scrollHeight;
  }
  function renderAnswer(turn) {
    const node = turn.answer;
    node.classList.toggle('pending', !turn.text && !turn.done);
    node.classList.toggle('streaming', !turn.done);
    node.classList.toggle('error', !!turn.error);
    if (!turn.done || turn.error) {
      node.textContent = turn.text || 'Thinking…';
      return;
    }
    // Parse into an inert document; only a small set of Markdown elements survives.
    const template = document.createElement('template');
    template.innerHTML = marked.parse(turn.text || '');
    const parsed = template.content;
    const allowed = new Set(['P','BR','STRONG','EM','DEL','H1','H2','H3','H4','H5','H6','UL','OL','LI','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TR','TH','TD','HR','A','SUP','SUB']);
    for (const element of [...parsed.querySelectorAll('*')]) {
      if (!allowed.has(element.tagName)) { element.replaceWith(document.createTextNode(element.textContent || '')); continue; }
      const href = element.tagName === 'A' ? element.getAttribute('href') : null;
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
      if (href && /^https?:\/\//i.test(href)) {
        element.setAttribute('href', href);
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      }
    }
    node.replaceChildren(...parsed.childNodes);
    window.renderMathInElement?.(node);
    for (const pre of node.querySelectorAll('pre')) {
      const button = document.createElement('button');
      button.className = 'copy-btn'; button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        try {
          const text = pre.querySelector('code')?.textContent || pre.textContent;
          if (!await api.copyToClipboard(text)) throw new Error('Could not copy this code.');
          button.textContent = 'Copied';
          setTimeout(() => { button.textContent = 'Copy'; }, 1200);
        } catch (error) { notice(error.message); }
      });
      pre.append(button);
    }
  }
  function startTurn(data) {
    const id = data.messageId;
    if (!id || discarded.has(id)) return null;
    if (turns.has(id)) return turns.get(id);
    const section = document.createElement('article');
    section.className = 'conversation-turn'; section.dataset.messageId = id;
    const turn = { id, prompt: data.prompt || '', source: data.source || 'text', skill: data.skill || '', text: '', done: false, error: false, section };
    if (turn.prompt) {
      const question = document.createElement('div'); question.className = 'user-prompt';
      const label = document.createElement('span'); label.className = 'prompt-source';
      label.textContent = turn.source === 'voice' ? 'Heard' : turn.source === 'screenshot' ? 'Screenshot' : 'You';
      const text = document.createElement('span'); text.className = 'prompt-text'; text.textContent = turn.prompt;
      question.append(label, text); section.append(question);
    }
    turn.answer = document.createElement('div'); turn.answer.className = 'assistant-response markdown-content';
    section.append(turn.answer); turns.set(id, turn);
    followScroll(() => { el('emptyState').hidden = true; el('chatMessages').append(section); renderAnswer(turn); });
    if (turn.source === 'voice') { transcript.textContent = ''; transcript.hidden = true; }
    persist();
    return turn;
  }
  function finishTurn(data, error = false) {
    const id = data.messageId || data.metadata?.messageId;
    if (discarded.has(id)) return;
    const text = data.response ?? data.content ?? data.error ?? '';
    if (!id && !text) return;
    const turn = turns.get(id) || startTurn({ ...data, messageId: id || `display-${Date.now()}-${++localSequence}` });
    if (!turn || (turn.done && turn.text === text && turn.error === error)) return;
    turn.text = String(text); turn.done = true; turn.error = error;
    followScroll(() => renderAnswer(turn)); persist();
  }
  function restore() {
    restoring = true;
    try {
      const records = JSON.parse(localStorage.getItem(historyKey) || '[]');
      if (!Array.isArray(records)) return;
      // Keep older chat history readable when upgrading from the separate window.
      for (const item of records.slice(-200)) {
        if (!item || typeof item !== 'object') continue;
        const id = item.id || `history-${++localSequence}`;
        if (item.kind === 'turn') {
          const turn = startTurn({ messageId: id, prompt: String(item.prompt || ''), source: item.source, skill: item.skill });
          if (turn) finishTurn({ messageId: id, response: item.done ? String(item.text || '') : 'Answer interrupted. Send the question again.' }, !!item.error || !item.done);
        } else if (item.kind === 'message' && typeof item.text === 'string') {
          startTurn({ messageId: id, prompt: item.type === 'user' ? item.text : '' });
          finishTurn({ messageId: id, response: item.type === 'user' ? '' : item.text });
        } else if (item.kind === 'snippet' && typeof item.code === 'string') {
          startTurn({ messageId: id }); finishTurn({ messageId: id, response: '```\n' + item.code + '\n```' });
        }
      }
    } catch (_) { notice('Stored conversation could not be loaded. New questions still work.'); }
    finally { restoring = false; }
  }
  function clearConversation() {
    for (const id of turns.keys()) discarded.add(id);
    turns.clear(); el('chatMessages').replaceChildren(); el('emptyState').hidden = false;
    transcript.textContent = ''; transcript.hidden = true; notice(); persist();
  }
  function updateVoiceControls() {
    el('listenLabel').textContent = recording ? 'Stop listening' : processing ? 'Finishing…' : available ? 'Listen' : 'Set up voice';
    el('listenButton').classList.toggle('listening', recording);
    el('listenButton').setAttribute('aria-pressed', String(recording));
    el('listenButton').disabled = changingCapture || (!recording && processing) || !interactive;
    el('audioSource').disabled = recording || processing || changingCapture || !interactive;
    if (!recording) el('voiceLevel').value = 0;
  }
  function setSource(data) {
    if (data.audioSource) el('audioSource').value = data.audioSource;
    if (typeof data.systemAudioSupported === 'boolean') {
      for (const option of el('audioSource').options) option.disabled = option.value !== 'microphone' && !data.systemAudioSupported;
    }
  }
  function setSpeechState(data) {
    if (typeof data.isRecording === 'boolean') recording = data.isRecording;
    if (typeof data.isProcessingAudio === 'boolean') processing = data.isProcessingAudio;
    if (typeof data.available === 'boolean') available = data.available;
    if (data.status && !speechError) el('voiceStatusText').textContent = data.status;
    updateVoiceControls();
  }
  async function refreshState() {
    const [settings, capture, speechAvailable, stats] = await Promise.all([
      api.getSettings(), api.getSpeechCaptureConfig(), api.getSpeechAvailability(), api.getWindowStats()
    ]);
    skillCatalog = settings.availableSkills || [];
    el('activeSkill').replaceChildren(...skillCatalog.map(skill => new Option(skill.name, skill.id)));
    el('activeSkill').value = settings.activeSkill;
    interactive = stats.isInteractive !== false;
    el('activeSkill').disabled = !interactive;
    el('messageInput').disabled = !interactive; el('sendButton').disabled = !interactive;
    el('interactionHint').hidden = interactive;
    setSource({ audioSource: capture.audioSource, systemAudioSupported: settings.systemAudioSupported });
    setSpeechState({ ...capture, available: speechAvailable });
  }

  api.onTranscriptionLlmResponseStart((_event, data) => { notice(); startTurn(data); });
  api.onTranscriptionLlmResponseChunk((_event, data) => {
    const turn = turns.get(data.messageId);
    if (!turn || turn.done || typeof data.delta !== 'string') return;
    turn.text += data.delta;
    followScroll(() => renderAnswer(turn));
  });
  api.onTranscriptionLlmResponse((_event, data) => finishTurn(data));
  api.onDisplayLlmResponse((_event, data) => finishTurn(data));
  api.onTranscriptionLlmResponseError((_event, data) => finishTurn({ ...data, response: data.error || 'Could not complete the answer. Try again.' }, true));
  api.onShowLoading(() => {}); // The pending answer is shown inline; keep the composer usable.
  api.onLlmError((_event, data) => notice(data.error || 'Could not answer. Check your AI settings.'));
  api.onOcrError((_event, data) => notice(data.error || 'Could not capture the question. Try again.'));
  api.onInterimTranscription((_event, data) => { transcript.textContent = data.text || ''; transcript.hidden = !data.text; });
  api.onTranscriptionReceived((_event, data) => { transcript.textContent = data.text || ''; transcript.hidden = !data.text; });
  api.onSpeechLevel((_event, data) => { el('voiceLevel').value = data.level || 0; });
  api.onSpeechAvailability((_event, data) => { available = !!data.available; updateVoiceControls(); });
  api.onRecordingStarted((_event, data = {}) => {
    speechError = false; el('voiceStatusText').classList.remove('error');
    setSource(data); setSpeechState({ isRecording: true, isProcessingAudio: false, status: 'Listening — questions are sent after a pause' });
  });
  api.onRecordingStopped(() => setSpeechState({ isRecording: false }));
  api.onSpeechStatus((_event, data) => setSpeechState(data));
  api.onSpeechError((_event, data) => {
    speechError = true; el('voiceStatusText').textContent = data.error || 'Audio capture failed.';
    el('voiceStatusText').classList.add('error'); setSpeechState(data);
  });
  api.onSkillChanged((_event, data) => { el('activeSkill').value = data.skill; });
  api.onSessionCleared(clearConversation);
  api.receive('audio-settings-changed', (_event, data) => setSource(data));
  api.onInteractionModeChanged((_event, enabled) => {
    interactive = !!enabled; el('interactionHint').hidden = interactive;
    el('activeSkill').disabled = !interactive; el('messageInput').disabled = !interactive;
    el('sendButton').disabled = !interactive || sending; updateVoiceControls();
  });
  el('promptForm').addEventListener('submit', async event => {
    event.preventDefault();
    const input = el('messageInput'), text = input.value.trim();
    if (!text || sending || !interactive) return;
    sending = true; el('sendButton').disabled = true; notice();
    try {
      const result = await api.sendChatMessage(text);
      if (!result.success) throw new Error(result.error || 'Could not send the question.');
      if (input.value.trim() === text) input.value = '';
      el('conversation').scrollTop = el('conversation').scrollHeight;
    } catch (error) { notice(error.message); }
    finally { sending = false; el('sendButton').disabled = !interactive; input.focus(); }
  });
  el('messageInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); el('promptForm').requestSubmit(); }
  });
  el('listenButton').addEventListener('click', async () => {
    if (changingCapture) return;
    if (!recording && !available) { await api.showSettings(); return; }
    changingCapture = true; updateVoiceControls(); notice();
    try {
      const result = recording ? await api.stopSpeechRecognition()
        : await api.startSpeechRecognition({ audioSource: el('audioSource').value });
      if (!result.success) throw new Error(result.error || 'Could not change listening state.');
      setSpeechState(result);
    } catch (error) { notice(error.message); }
    finally { changingCapture = false; updateVoiceControls(); }
  });
  el('audioSource').addEventListener('change', async () => {
    try {
      const result = await api.saveSettings({ whisperAudioSource: el('audioSource').value });
      if (!result.success) throw new Error(result.error || 'Could not save the audio source.');
    } catch (error) { notice(error.message); setSource(await api.getSpeechCaptureConfig()); }
  });
  el('activeSkill').addEventListener('change', async () => {
    try {
      const result = await api.updateActiveSkill(el('activeSkill').value);
      if (!result.success) throw new Error(result.error || 'Could not change mode.');
    } catch (error) { notice(error.message); el('activeSkill').value = (await api.getSettings()).activeSkill; }
  });
  el('clearHistoryBtn').addEventListener('click', async () => {
    if (!await window.protectedUI.confirm('Clear this conversation and its AI context?')) return;
    try { await api.clearSessionMemory(); } catch (error) { notice(error.message); }
  });
  el('captureButton').addEventListener('click', () => api.takeScreenshot().catch(error => notice(error.message)));
  el('settingsButton').addEventListener('click', () => api.showSettings());
  el('minimizeButton').addEventListener('click', async () => {
    try {
      const result = await api.minimizeToDot();
      if (!result.success) throw new Error(result.error || 'Could not minimize Bakame.');
    } catch (error) { notice(error.message); }
  });
  el('close-window-btn').addEventListener('click', () => api.closeWindow());
  restore();
  refreshState().catch(error => notice(`Could not load assistant settings: ${error.message}`));
});
