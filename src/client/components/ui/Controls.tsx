import { useId, type ReactNode } from 'react';
import { Slider as RSlider, Switch as RSwitch, ToggleGroup } from 'radix-ui';

export function Switch({
  checked,
  onCheckedChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onCheckedChange(v: boolean): void;
  label?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <RSwitch.Root className="switch" checked={checked} onCheckedChange={onCheckedChange} aria-label={label} id={id} disabled={disabled}>
      <RSwitch.Thumb className="switch__thumb" />
    </RSwitch.Root>
  );
}

export function Slider({
  value,
  onValueChange,
  min,
  max,
  step,
  label,
  disabled,
  valueText,
}: {
  value: number;
  onValueChange(v: number): void;
  min: number;
  max: number;
  step: number;
  label: string;
  disabled?: boolean;
  valueText?: string;
}) {
  return (
    <RSlider.Root
      className="slider"
      value={[value]}
      onValueChange={(v) => onValueChange(v[0]!)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      <RSlider.Track className="slider__track">
        <RSlider.Range className="slider__range" />
      </RSlider.Track>
      <RSlider.Thumb className="slider__thumb" aria-label={label} aria-valuetext={valueText} />
    </RSlider.Root>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  block,
}: {
  value: T;
  onValueChange(v: T): void;
  options: ReadonlyArray<SegmentOption<T>>;
  label: string;
  block?: boolean;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className={block ? 'segmented segmented--block' : 'segmented'}
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={label}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className="segmented__item" disabled={o.disabled} title={o.title} aria-label={o.title}>
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

/** A labelled settings row: text on the left, control on the right. */
export function SettingRow({
  label,
  description,
  children,
  stacked,
}: {
  label: string;
  description?: string;
  children: (id: string) => ReactNode;
  stacked?: boolean;
}) {
  const id = useId();
  return (
    <div className={stacked ? 'setting-row setting-row--stacked' : 'setting-row'}>
      <div className="setting-row__text">
        <label className="setting-row__label" htmlFor={id} id={`${id}-label`}>
          {label}
        </label>
        {description && <p className="setting-row__description">{description}</p>}
      </div>
      <div className="setting-row__control">{children(id)}</div>
    </div>
  );
}
