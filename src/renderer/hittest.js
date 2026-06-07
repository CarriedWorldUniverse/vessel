// The mac-first reference build is a focused app window, not a transparent
// click-through overlay. Keep hit testing enabled across the whole stage.
window.vessel?.setIgnoreMouseEvents(false);
