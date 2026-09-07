import { useCallback, useEffect, useRef, useState } from "react";

/** Draggable panel width, persisted in localStorage under `key`. */
export function useResizable(key: string, initial: number, min = 180, max = 800) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return saved >= min && saved <= max ? saved : initial;
  });
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      drag.current = { startX: e.clientX, startW: width };
      document.body.classList.add("resizing");
      e.preventDefault();
    },
    [width]
  );

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      setWidth(Math.min(max, Math.max(min, drag.current.startW + e.clientX - drag.current.startX)));
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.classList.remove("resizing");
      setWidth((w) => {
        localStorage.setItem(key, String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [key, min, max]);

  return [width, onMouseDown] as const;
}

/** Draggable panel height (drag up = taller), persisted under `key`. */
export function useResizableY(key: string, initial: number, min = 120, max = 700) {
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return saved >= min && saved <= max ? saved : initial;
  });
  const drag = useRef<{ startY: number; startH: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      drag.current = { startY: e.clientY, startH: height };
      document.body.classList.add("resizing-y");
      e.preventDefault();
    },
    [height]
  );

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      setHeight(Math.min(max, Math.max(min, drag.current.startH + drag.current.startY - e.clientY)));
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.classList.remove("resizing-y");
      setHeight((h) => {
        localStorage.setItem(key, String(h));
        return h;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [key, min, max]);

  return [height, onMouseDown] as const;
}
