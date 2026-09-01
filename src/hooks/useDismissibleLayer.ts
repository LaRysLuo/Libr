import { useEffect, useRef, type RefObject } from "react";

interface DismissibleLayerOptions<TLayer extends HTMLElement, TTrigger extends HTMLElement = HTMLElement> {
  open: boolean;
  layerRef: RefObject<TLayer | null>;
  triggerRef?: RefObject<TTrigger | null>;
  onDismiss: () => void;
  closeOnScroll?: boolean;
}

export function useDismissibleLayer<TLayer extends HTMLElement, TTrigger extends HTMLElement = HTMLElement>({
  open,
  layerRef,
  triggerRef,
  onDismiss,
  closeOnScroll = false,
}: DismissibleLayerOptions<TLayer, TTrigger>) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;

    const dismiss = () => onDismissRef.current();
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (layerRef.current?.contains(target) || triggerRef?.current?.contains(target)) return;
      dismiss();
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    document.addEventListener("pointerdown", closeFromOutside, true);
    window.addEventListener("keydown", closeFromKeyboard);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    if (closeOnScroll) window.addEventListener("scroll", dismiss, true);

    return () => {
      document.removeEventListener("pointerdown", closeFromOutside, true);
      window.removeEventListener("keydown", closeFromKeyboard);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      if (closeOnScroll) window.removeEventListener("scroll", dismiss, true);
    };
  }, [closeOnScroll, layerRef, open, triggerRef]);
}
