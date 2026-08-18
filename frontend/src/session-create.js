export function nextNumericSessionName(sessions) {
  const names = new Set(sessions.map((session) => session.name));
  for (let candidate = 0; ; candidate += 1) {
    if (!names.has(String(candidate))) return String(candidate);
  }
}

export function sessionPathOptions(recentPaths, sessions, limit = 10) {
  const paths = [...recentPaths, ...sessions.map((session) => session.path)];
  return [...new Set(paths.filter(isAbsolutePath))].slice(0, limit);
}

export function addRecentPath(recentPaths, path, limit = 10) {
  if (!isAbsolutePath(path)) return recentPaths;
  return [path, ...recentPaths.filter((candidate) => candidate !== path)].slice(0, limit);
}

function isAbsolutePath(path) {
  return typeof path === 'string' && path.startsWith('/');
}
