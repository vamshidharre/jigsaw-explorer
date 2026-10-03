/** Shares text or a link with the native share sheet when there is one, otherwise copies it. */
export async function shareOrCopy(data: { text: string; url?: string; title?: string }): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  // Native sharing on touch devices; desktop browsers' share dialogs are clumsier than a copy.
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  if (touch && typeof nav.share === 'function') {
    const payload: ShareData = { text: data.text, url: data.url, title: data.title };
    if (!nav.canShare || nav.canShare(payload)) {
      try {
        await nav.share(payload);
        return 'shared';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      }
    }
  }
  return (await copyText(data.url && !data.text.includes(data.url) ? `${data.text}\n${data.url}` : data.text)) ? 'copied' : 'failed';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure contexts.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
