import { Link } from 'react-router';
import { ArrowRight, Flame } from 'lucide-react';
import { catalogThumbUrl, getCatalogImage } from '../../../shared/catalog';
import { dailyPuzzle } from '../../../shared/daily';
import { formatDuration } from '../../lib/format';
import { dailyResults, dailyStats } from '../../persistence/daily';
import { useToday } from './DailyPage';

/** Home-page entry point to today's puzzle. */
export function DailyCard() {
  const today = useToday();
  const puzzle = dailyPuzzle(today);
  const image = getCatalogImage(puzzle.imageId)!;
  const results = dailyResults();
  const result = results[today];
  const { currentStreak } = dailyStats(today, results);
  const pieces = puzzle.spec.cols * puzzle.spec.rows;

  return (
    <Link to="/daily" className="daily-card">
      <span className="daily-card__thumb" style={{ backgroundColor: image.color, backgroundImage: `url(${image.blur})` }}>
        <img src={catalogThumbUrl(image.id)} alt="" loading="lazy" />
      </span>
      <span className="daily-card__info">
        <span className="daily-card__eyebrow">Daily puzzle #{puzzle.number}</span>
        <span className="daily-card__title">{result ? `Solved in ${formatDuration(result.ms)}` : `${image.title} · ${pieces} pieces`}</span>
        <span className="daily-card__meta">
          {currentStreak > 1 ? (
            <>
              <Flame aria-hidden="true" size={14} />
              {currentStreak}-day streak
            </>
          ) : (
            'The same puzzle for everyone, new every day'
          )}
        </span>
      </span>
      <span className="daily-card__cta">
        {result ? 'See result' : 'Play'}
        <ArrowRight aria-hidden="true" size={16} />
      </span>
    </Link>
  );
}
