// Right panel overlay — shows active speaker's long-form content
import { stageState, onStateChange } from './state.js';

const panel = document.getElementById('right-panel');
const content = document.getElementById('right-panel-content');
const THRESHOLD = 200;  // chars before panel appears

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
