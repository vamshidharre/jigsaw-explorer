import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { toast } from 'sonner';
import { useUi, type SetupMode } from '../../app/uiStore';
import { ImageLoadError, processUpload } from '../../lib/images';

/**
 * Choosing or dropping a photo: validates and downscales it in the browser,
 * then opens the setup dialog for it.
 */
export function usePhotoPicker(mode: SetupMode) {
  const openSetup = useUi((s) => s.openSetup);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const handleFile = async (file: File | undefined) => {
    if (!file || processing) return;
    setProcessing(true);
    try {
      const upload = await processUpload(file);
      openSetup({ kind: 'local', upload }, mode);
    } catch (err) {
      toast.error(err instanceof ImageLoadError ? err.message : 'That image could not be used. Try a different file.');
    } finally {
      setProcessing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const dropZone = {
    onDragEnter: (e: DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      void handleFile(e.dataTransfer.files[0]);
    },
  };

  const inputProps = {
    ref: inputRef,
    type: 'file',
    accept: 'image/*',
    className: 'visually-hidden',
    tabIndex: -1,
    'aria-hidden': true,
    onChange: (e: ChangeEvent<HTMLInputElement>) => void handleFile(e.target.files?.[0]),
  } as const;

  return { processing, dragging, pick: () => inputRef.current?.click(), dropZone, inputProps };
}
