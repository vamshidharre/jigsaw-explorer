import type { CSSProperties, ReactNode } from 'react';
import { Dialog as RDialog } from 'radix-ui';
import { X } from 'lucide-react';
import { IconButton } from './Button';

interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Render as a bottom sheet on small screens. */
  mobileSheet?: boolean;
  hideClose?: boolean;
  /** Set to false to prevent closing by clicking outside or pressing Escape (e.g. required name entry). */
  dismissible?: boolean;
  className?: string;
  initialFocus?: () => HTMLElement | null;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width,
  mobileSheet,
  hideClose,
  dismissible = true,
  className,
  initialFocus,
}: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-overlay" />
        <RDialog.Content
          className={['dialog', mobileSheet && 'dialog--mobile-sheet', className].filter(Boolean).join(' ')}
          style={width ? ({ '--dialog-w': `${width}px` } as CSSProperties) : undefined}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          onInteractOutside={(e) => !dismissible && e.preventDefault()}
          onOpenAutoFocus={(e) => {
            // Focus the dialog itself rather than the close button, so no tooltip pops up on open.
            e.preventDefault();
            const el = initialFocus?.() ?? (e.currentTarget as HTMLElement | null);
            el?.focus({ preventScroll: true });
          }}
          tabIndex={-1}
        >
          <div className="dialog__header">
            <div>
              <RDialog.Title className="dialog__title">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="dialog__description">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="visually-hidden">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>
              )}
            </div>
            {!hideClose && dismissible && (
              <RDialog.Close asChild>
                <IconButton label="Close" className="dialog__close" size="sm" tooltipSide="left">
                  <X />
                </IconButton>
              </RDialog.Close>
            )}
          </div>
          <div className="dialog__body">{children}</div>
          {footer && <div className="dialog__footer">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

interface SheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  children: ReactNode;
  description?: string;
}

/** Side panel on desktop, bottom sheet on phones. */
export function Sheet({ open, onOpenChange, title, children, description }: SheetProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-overlay" />
        <RDialog.Content
          className="sheet"
          tabIndex={-1}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
        >
          <div className="sheet__header">
            <RDialog.Title className="dialog__title">{title}</RDialog.Title>
            <RDialog.Description className="visually-hidden">{description ?? (typeof title === 'string' ? title : '')}</RDialog.Description>
            <RDialog.Close asChild>
              <IconButton label="Close" size="sm" tooltipSide="left">
                <X />
              </IconButton>
            </RDialog.Close>
          </div>
          <div className="sheet__body">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
