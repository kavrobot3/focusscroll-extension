export default defineBackground(() => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[FocusScroll] Background service worker initialized');
  }
});

