import { FlameIcon } from '../icons';

/** heatmap.com lockup — mark + lowercase wordmark (same recipe as site chrome). */
export function HeatmapBrand() {
  return (
    <div className="hm-brand-lockup" aria-label="heatmap">
      <span className="hm-brand-lockup__mark" aria-hidden="true">
        <FlameIcon size={24} />
      </span>
      <span className="hm-brand-lockup__name">heatmap</span>
    </div>
  );
}
