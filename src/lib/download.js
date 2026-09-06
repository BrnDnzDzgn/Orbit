/**
 * Hands the browser a file.
 *
 * An object URL rather than a data: URI, so a large export doesn't have to
 * survive being encoded into an attribute.
 */
export function downloadFile(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next turn of the loop; revoking synchronously can beat the
  // download starting in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
