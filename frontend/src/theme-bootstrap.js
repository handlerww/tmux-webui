try {
  const saved = localStorage.getItem('tmux-webui.theme');
  const setting = ['system', 'light', 'dark'].includes(saved) ? saved : 'system';
  const resolved = setting === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : setting;
  document.documentElement.dataset.theme = setting;
  document.documentElement.dataset.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]').content = resolved === 'dark' ? '#151a18' : '#f3f1eb';
} catch {
  document.documentElement.dataset.colorScheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
