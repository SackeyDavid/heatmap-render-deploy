import { screens } from '../copy';
import { FlameIcon } from '../icons';

/** heatmap.com lockup — mark + lowercase wordmark (same recipe as site chrome). */
export function HeatmapBrand() {
  return (
    <div className="hm-brand-row-tag">
      <div className="hm-brand-lockup" aria-label="heatmap">
        <span className="hm-brand-lockup__mark" aria-hidden="true">
          <FlameIcon size={24} />
        </span>
        <span className="hm-brand-lockup__name">heatmap</span>
      </div>
      <span className="hm-engine-tag">
        <span className="hm-engine-tag__dot" aria-hidden="true" />
        {screens.brand.engineTag}
      </span>
    </div>
  );
}
