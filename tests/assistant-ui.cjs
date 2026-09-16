const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ manager, windows, evaluate, waitFor, delay, testDir }) => {
  const run = expression => evaluate('llmResponse', expression);
  await run(`document.getElementById('messageInput').value = 'Explain a process in simple English'; document.getElementById('promptForm').requestSubmit()`);
  await waitFor(() => run(`document.querySelector('.user-prompt .prompt-text')?.textContent === 'Explain a process in simple English'`), 'typed question appears');
  await waitFor(() => run(`document.querySelector('.assistant-response')?.textContent.includes('A useful answer')`), 'typed answer streams and completes');
  assert.equal(await run(`getComputedStyle(document.querySelector('.user-prompt')).color`), 'rgb(255, 255, 255)');
  assert.equal(await run(`getComputedStyle(document.querySelector('.assistant-response')).color`), 'rgb(131, 226, 160)');
  assert.equal(await run(`document.getElementById('messageInput').value`), '');
  assert.equal(windows.size, 3);
  const send = (channel, data) => manager.broadcastToAllWindows(channel, data);
  send('transcription-llm-response-start', { messageId: 'spoken-question', source: 'voice', prompt: 'Give an example.' });
  send('transcription-llm-response', { messageId: 'spoken-question', response: 'A **browser** is a process.\n\n```js\nconsole.log("hello");\n```' });
  await waitFor(() => run(`document.querySelector('[data-message-id="spoken-question"] strong')?.textContent === 'browser'`), 'spoken question shares the conversation');
  send('transcription-llm-response-start', { messageId: 'unsafe-markdown', prompt: '<img src=x onerror=alert(1)>' });
  send('transcription-llm-response', { messageId: 'unsafe-markdown', response: '<img src="https://invalid.example/tracker" onerror="window.unsafe=true"><script>window.unsafe=true</script>[link](javascript:alert(1))' });
  await waitFor(() => run(`document.querySelector('[data-message-id="unsafe-markdown"] .assistant-response').textContent.includes('link')`), 'unsafe response rendered safely');
  assert.equal(await run(`!!window.unsafe || !!document.querySelector('.assistant-response img,.assistant-response script,.assistant-response a[href^="javascript:"]')`), false);
  send('transcription-llm-response-start', { messageId: 'pending-clear', prompt: 'Pending question' });
  await run(`document.getElementById('clearHistoryBtn').click()`);
  await run(`document.querySelector('.protected-accept').click()`);
  await waitFor(() => run(`document.querySelectorAll('.conversation-turn').length === 0`), 'clear removes questions and answers');
  send('transcription-llm-response', { messageId: 'pending-clear', response: 'Late response' });
  await delay(100);
  assert.equal(await run(`document.querySelectorAll('.conversation-turn').length`), 0);
  send('transcription-llm-response-start', { messageId: 'visual-question', source: 'voice', prompt: 'What is the difference between a process and a thread?' });
  send('transcription-llm-response', { messageId: 'visual-question', response: 'A **process** is a running program with its own memory. A **thread** is a task inside a process; threads share that process\'s memory.\n\nFor example, a browser can use one thread to display a page and another to download a file.' });
  await delay(200);
  const window = windows.get('llmResponse');
  for (const [width, height, name] of [[840, 480, 'conversation'], [420, 380, 'conversation-small']]) {
    window.setSize(width, height + 1);
    await delay(100);
    window.setSize(width, height);
    await delay(150);
    assert.equal(await run(`(() => { const r = document.getElementById('sendButton').getBoundingClientRect(); const l = document.getElementById('listenButton').getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && l.left >= 0; })()`), true, 'composer stays inside resized window');
    fs.writeFileSync(path.join(testDir, name + '.png'), (await window.webContents.capturePage()).toPNG());
  }
  window.setSize(840, 480);
  console.log('PASS: one conversation, typed and spoken prompts, white questions, green formatted answers, safe Markdown, clear during streaming, and compact layout');
};
