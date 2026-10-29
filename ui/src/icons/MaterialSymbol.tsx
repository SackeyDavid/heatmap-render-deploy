import type { HTMLAttributes } from 'react';

export type MaterialSymbolName =
  | 'water_drop'
  | 'verified_user'
  | 'auto_awesome'
  | 'arrow_back_ios_new'
  | 'drag_handle'
  | 'keyboard'
  | 'description'
  | 'link'
  | 'article'
  | 'add'
  | 'output'
  | 'key'
  | 'mail'
  | 'code'
  | 'tune'
  | 'lightbulb'
  | 'html'
  | 'science'
  | 'expand_more'
  | 'arrow_forward'
  | 'lock'
  | 'check_circle'
  | 'layers'
  | 'task_alt'
  | 'visibility'
  | 'info'
  | 'shield_with_heart'
  | 'chevron_right'
  | 'open_in_new'
  | 'check'
  | 'content_copy'
  | 'verified'
  | 'touch_app'
  | 'help_outline'
  | 'logout'
  | 'account_circle';

export interface MaterialSymbolProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  name: MaterialSymbolName;
  size?: number;
  /** Material Symbols FILL axis (0 outline, 1 filled). */
  fill?: 0 | 1;
}

/** Stitch Material Symbols Outlined glyph — decorative by default. */
export function MaterialSymbol({
  name,
  size = 20,
  fill = 0,
  className,
  style,
  ...rest
}: MaterialSymbolProps) {
  const classes = className ? `material-symbols-outlined ${className}` : 'material-symbols-outlined';
  return (
    <span
      className={classes}
      aria-hidden="true"
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill}`,
        ...style,
      }}
      {...rest}
    >
      {name}
    </span>
  );
}
