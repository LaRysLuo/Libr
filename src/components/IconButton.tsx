import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  selected?: boolean;
}

export function IconButton({ label, children, selected = false, className = "", ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${selected ? "is-selected" : ""} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
