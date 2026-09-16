document.addEventListener('DOMContentLoaded', () => {
  const api = window.electronAPI;
  const dot = document.getElementById('restoreDot');
  let gesture = null;
  const cancel = () => {
    if (!gesture) return;
    clearTimeout(gesture.timer);
    gesture = null;
    dot.classList.remove('moving');
    api.moveMiniDot('end').catch(() => {});
  };
  dot.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || gesture) return;
    const current = { id: event.pointerId, x: event.clientX, y: event.clientY, held: false, moved: false };
    gesture = current;
    dot.setPointerCapture(event.pointerId);
    current.timer = setTimeout(() => {
      if (gesture !== current || current.moved) return;
      current.held = true;
      dot.classList.add('moving');
      api.moveMiniDot('start').catch(cancel);
    }, 450);
  });
  dot.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (gesture.held) api.moveMiniDot('move').catch(cancel);
    else if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) {
      gesture.moved = true;
      clearTimeout(gesture.timer);
    }
  });
  dot.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const activate = !gesture.held && !gesture.moved;
    cancel();
    if (dot.hasPointerCapture(event.pointerId)) dot.releasePointerCapture(event.pointerId);
    if (activate) api.restoreFromDot();
  });
  dot.addEventListener('pointercancel', cancel);
  dot.addEventListener('lostpointercapture', cancel);
  dot.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); });
  // Native button keyboard activation sends click with detail=0.
  dot.addEventListener('click', event => { if (event.detail === 0 && !gesture) api.restoreFromDot(); });
  window.addEventListener('blur', cancel);
  const recording = enabled => {
    dot.classList.toggle('listening', enabled);
    dot.setAttribute('aria-label', `Restore Bakame${enabled ? ' (listening)' : ''}. Hold and drag to move.`);
  };
  api.onRecordingStarted(() => recording(true));
  api.onRecordingStopped(() => recording(false));
  api.getSpeechCaptureConfig().then(state => recording(state.isRecording)).catch(() => {});
});
