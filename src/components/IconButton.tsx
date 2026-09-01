import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  selected?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, children, selected = false, className = "", ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={`icon-button ${selected ? "is-selected" : ""} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
});
