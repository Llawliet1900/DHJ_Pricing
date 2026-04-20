import { useEffect, useRef, useState } from 'react';

// 数字输入（处理 ""、0、失焦格式化）
export function NumInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  digits,
  className = '',
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState<string>(formatNum(value, digits));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(formatNum(value, digits));
  }, [value, digits]);
  return (
    <input
      className={`dhj ${className}`}
      type="number"
      step={step}
      min={min}
      max={max}
      value={text}
      disabled={disabled}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        const n = parseFloat(text);
        if (Number.isFinite(n)) onChange(clamp(n, min, max));
        else setText(formatNum(value, digits));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) onChange(clamp(n, min, max));
      }}
    />
  );
}

// 百分比输入（存 0-1，显示 0-100）
export function PctInput({
  value,
  onChange,
  step = 0.1,
  min = 0,
  max = 1,
  className = '',
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <NumInput
        value={value * 100}
        onChange={(n) => onChange(clamp(n / 100, min, max))}
        step={step}
        digits={2}
      />
      <span className="text-slate-500 text-xs shrink-0">%</span>
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  className = '',
  placeholder,
}: {
  value: string;
  onChange: (s: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <input
      className={`dhj ${className}`}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <select className={`dhj ${className}`} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ checked, onChange }: { checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <input
      type="checkbox"
      className="w-4 h-4 accent-blue-600 cursor-pointer"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function formatNum(n: number, digits?: number) {
  if (!Number.isFinite(n)) return '';
  if (digits == null) return String(n);
  return n.toFixed(digits);
}

function clamp(n: number, min?: number, max?: number) {
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}
