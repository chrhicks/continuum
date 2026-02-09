export function continuumDir(directory: string): string {
  return `${directory}/.continuum`
}

export function dbFilePath(directory: string): string {
  return `${continuumDir(directory)}/continuum.db`
}
