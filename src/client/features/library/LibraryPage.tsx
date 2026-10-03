import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { pageTitle } from '../../../shared/brand';
import { CATALOG, CATEGORIES, type CategoryId } from '../../../shared/catalog';
import { PageShell } from '../../components/layout/SiteHeader';
import { PuzzleCard } from '../../components/PuzzleCard';
import { Spinner } from '../../components/ui/Button';
import { useUi } from '../../app/uiStore';
import { ImageLoadError, processUpload } from '../../lib/images';

export function LibraryPage() {
  const [params] = useSearchParams();
  const mode = params.get('mode') === 'room' ? 'room' : 'solo';
  const [category, setCategory] = useState<CategoryId | 'all'>(() => {
    const requested = params.get('category');
    return CATEGORIES.find((c) => c.id === requested)?.id ?? 'all';
  });
  const openSetup = useUi((s) => s.openSetup);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    document.title = pageTitle(mode === 'room' ? 'Choose a puzzle for your room' : 'Puzzles');
  }, [mode]);

  const images = useMemo(() => (category === 'all' ? CATALOG : CATALOG.filter((i) => i.category === category)), [category]);

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
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onDragEnter = (e: DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void handleFile(e.dataTransfer.files[0]);
  };

  return (
    <PageShell>
      <div
        className={dragging ? 'library is-dragging' : 'library'}
        onDragEnter={onDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <header className="page-head">
          <div>
            <h1>{mode === 'room' ? 'Choose a puzzle for your room' : 'Choose a puzzle'}</h1>
            <p className="page-head__lede">
              {mode === 'room'
                ? 'Pick a picture and difficulty. You will get a link to share with friends.'
                : 'Pick a picture, choose how many pieces, and start. Your progress saves automatically.'}
            </p>
          </div>
        </header>

        <div className="chips" role="group" aria-label="Filter by category">
          {[{ id: 'all' as const, label: 'All' }, ...CATEGORIES].map((c) => (
            <button
              key={c.id}
              aria-pressed={category === c.id}
              className="chip"
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="puzzle-grid puzzle-grid--library">
          <button className="upload-card" onClick={() => fileInput.current?.click()} disabled={processing} aria-describedby="upload-hint">
            <span className="upload-card__icon">{processing ? <Spinner size={22} label="Processing image" /> : <ImagePlus />}</span>
            <span className="upload-card__title">{processing ? 'Preparing your image…' : 'Use your own photo'}</span>
            <span className="upload-card__hint" id="upload-hint">
              JPG, PNG, WebP or GIF up to 25 MB. You can also drop a file here.
            </span>
          </button>
          {images.map((img) => (
            <PuzzleCard key={img.id} image={img} onSelect={(i) => openSetup({ kind: 'catalog', id: i.id }, mode)} />
          ))}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            <ImagePlus />
            <span>Drop your image to make a puzzle</span>
          </div>
        )}
      </div>
    </PageShell>
  );
}
