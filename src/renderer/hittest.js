// Tell the Electron main process to pass mouse events through transparent regions.
// We track whether the pointer is over an interactive overlay element.
// When it's not, the window is click-through so the operator can interact with
// the desktop beneath.

const interactiveEls = [
  document.getElementById('right-panel'),
  document.getElementById('input-bar'),
];

let currentlyIgnoring = false;

document.addEventListener('mousemove', (e) => {
  const overInteractive = interactiveEls.some(el => el.contains(e.target) || el === e.target);
  const shouldIgnore = !overInteractive;

  if (shouldIgnore !== currentlyIgnoring) {
    currentlyIgnoring = shouldIgnore;
    window.vessel?.setIgnoreMouseEvents(shouldIgnore);
  }
});
