import { useEffect } from 'react';
import { Link } from 'react-router';
import { Gift, ImagePlus, SlidersHorizontal, Users } from 'lucide-react';
import { pageTitle } from '../../../shared/brand';
import { catalogImageUrl, getCatalogImage } from '../../../shared/catalog';
import { MAX_PIECES, MIN_PIECES } from '../../../shared/puzzle/spec';
import { PageShell } from '../../components/layout/SiteHeader';
import { PuzzleArt } from '../../components/PuzzleArt';
import { Spinner } from '../../components/ui/Button';
import { usePhotoPicker } from '../library/usePhotoPicker';

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Is it free?',
    a: 'Yes. There is no account, no app to install and nothing to pay. Puzzles work in any modern browser on computers, tablets and phones.',
  },
  {
    q: 'What happens to my photo?',
    a: 'It is resized in your browser, and location and camera details are removed. A puzzle you play alone stays on your device. When you play with friends or send a link, a copy is uploaded so they can see it: photos in rooms are deleted within 48 hours after the room closes, and photos in puzzle links are deleted when the link expires after 30 days.',
  },
  {
    q: 'How many pieces can my puzzle have?',
    a: `Anything from ${MIN_PIECES} to ${MAX_PIECES.toLocaleString('en')} pieces. Larger photos allow more pieces while staying sharp; the setup screen shows the maximum for your picture. You can also turn on rotating pieces for an extra challenge.`,
  },
  {
    q: 'Can I give a puzzle as a present?',
    a: 'Yes. Choose “Send to a friend”, add your name and a message, and send the link. The picture stays blurred until they start solving it.',
  },
  {
    q: 'Which photos make the best puzzles?',
    a: 'Sharp, colourful photos with lots of different areas: people, pets, gardens, cities, holidays. Large areas of plain sky or water make a puzzle much harder.',
  },
];

/** Landing page for people looking to turn their own photo into a jigsaw puzzle. */
export function CreatePage() {
  const { processing, dragging, pick, dropZone, inputProps } = usePhotoPicker('solo');
  const sample = getCatalogImage('pug-portrait') ?? getCatalogImage('tabby-gaze')!;

  useEffect(() => {
    document.title = pageTitle('Make a jigsaw puzzle from your photo');
  }, []);

  return (
    <PageShell>
      <div className={dragging ? 'create is-dragging' : 'create'} {...dropZone}>
        <section className="hero create__hero">
          <div className="hero__copy">
            <p className="eyebrow">Photo puzzle maker</p>
            <h1 className="hero__title create__title">Make a jigsaw puzzle from your photo</h1>
            <p className="hero__lede">
              Turn any picture into an online jigsaw puzzle in seconds. Solve it yourself, piece it together with friends in real time, or send it to
              someone as a gift. Free, no sign-up.
            </p>
            <button className="create__drop" onClick={pick} disabled={processing} aria-describedby="create-drop-hint">
              <span className="create__drop-icon" aria-hidden="true">
                {processing ? <Spinner size={22} label="Processing image" /> : <ImagePlus />}
              </span>
              <span className="create__drop-title">{processing ? 'Preparing your photo…' : 'Choose a photo'}</span>
              <span className="create__drop-hint" id="create-drop-hint">
                or drop it here · JPG, PNG, WebP or GIF up to 25 MB
              </span>
            </button>
          </div>
          <div className="hero__art" aria-hidden="true">
            <PuzzleArt
              className="puzzle-art"
              src={catalogImageUrl(sample.id)}
              width={sample.width}
              height={sample.height}
              cols={5}
              rows={4}
              seed={23}
              lifted={[
                { piece: 3, dx: sample.width * 0.09, dy: -sample.height * 0.16, rotate: 8 },
                { piece: 15, dx: -sample.width * 0.1, dy: sample.height * 0.12, rotate: -7 },
              ]}
            />
          </div>
        </section>

        <section className="section create__steps" aria-labelledby="create-how">
          <h2 id="create-how" className="create__heading">
            How it works
          </h2>
          <ol className="steps-row">
            <li>
              <ImagePlus aria-hidden="true" className="feature__icon" />
              <h3>Pick a photo</h3>
              <p>From your phone or computer. It is prepared right in your browser.</p>
            </li>
            <li>
              <SlidersHorizontal aria-hidden="true" className="feature__icon" />
              <h3>Choose the pieces</h3>
              <p>
                From {MIN_PIECES} pieces for a quick break to {MAX_PIECES.toLocaleString('en')} for a weekend project, with optional rotating pieces.
              </p>
            </li>
            <li>
              <Users aria-hidden="true" className="feature__icon" />
              <h3>Play or share</h3>
              <p>Start solving, invite friends to solve it with you live, or send it as a link.</p>
            </li>
            <li>
              <Gift aria-hidden="true" className="feature__icon" />
              <h3>Make it a gift</h3>
              <p>Add a message. The picture stays a surprise until they put it together.</p>
            </li>
          </ol>
        </section>

        <section className="section create__faq" aria-labelledby="create-faq">
          <h2 id="create-faq" className="create__heading">
            Questions
          </h2>
          <div className="faq">
            {FAQ.map((item) => (
              <details key={item.q} className="faq__item">
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
          <p className="create__more">
            No photo at hand? <Link to="/puzzles">Choose one of ours</Link> or try <Link to="/daily">today's puzzle</Link>.
          </p>
        </section>

        <input {...inputProps} />
        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            <ImagePlus />
            <span>Drop your photo to make a puzzle</span>
          </div>
        )}
      </div>
    </PageShell>
  );
}
