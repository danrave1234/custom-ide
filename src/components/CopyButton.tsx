import { useRef, useState } from "react";

interface Props {
  getText: () => string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // webview clipboard API can be denied — fall back to execCommand
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export default function CopyButton({ getText }: Props) {
  const [label, setLabel] = useState("⧉ Copy");
  const timer = useRef<number | undefined>(undefined);

  const onClick = async () => {
    const ok = await copyText(getText());
    setLabel(ok ? "✓ Copied" : "✗ Failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLabel("⧉ Copy"), 1500);
  };

  return (
    <button className="mini-btn" onClick={onClick}>
      {label}
    </button>
  );
}
