// Right panel overlay — shows active speaker's long-form content
import { stageState, onStateChange } from './state.js';

const panel = document.getElementById('right-panel');
const content = document.getElementById('right-panel-content');
const THRESHOLD = 200;  // chars before panel appears

document.getElementById('close-window')?.addEventListener('click', () => {
  window.vessel?.closeWindow();
});

document.getElementById('minimize-window')?.addEventListener('click', () => {
  window.vessel?.minimizeWindow();
});

document.getElementById('toggle-top-window')?.addEventListener('click', () => {
  window.vessel?.toggleAlwaysOnTop();
});

function update(state) {
  const text = state.panelContent;
  if (text && text.length > THRESHOLD) {
    content.textContent = text;
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

onStateChange(update);
update(stageState);
