import { useEffect, useMemo, useRef } from "react";

/**
 * Segmented numeric PIN entry — one box per digit.
 *
 * Behaves the way users expect from an OTP/PIN field:
 *   • typing a digit advances to the next box automatically
 *   • Backspace clears the current box, or steps back when it is already empty
 *   • Arrow keys / Home / End move between boxes
 *   • pasting a code fills every box from the caret position
 *   • non-digits are rejected on entry, not after the fact
 *   • `masked` renders dots while keeping numeric input semantics
 *
 * Controlled: the value is always the joined string, so it drops straight into
 * an antd `Form.Item` (which injects `value` / `onChange`) with no adapter.
 */
export default function PinInput({
  value = "",
  onChange,
  onComplete,
  length = 6,
  masked = true,
  autoFocus = false,
  disabled = false,
  allowPaste = true,
  status,
}) {
  const inputsRef = useRef([]);

  const digits = useMemo(() => {
    const clean = String(value ?? "").replace(/\D/g, "").slice(0, length);
    return Array.from({ length }, (_, index) => clean[index] || "");
  }, [value, length]);

  useEffect(() => {
    if (autoFocus && !disabled) inputsRef.current[0]?.focus();
  }, [autoFocus, disabled]);

  const emit = (nextDigits, { focusIndex } = {}) => {
    const next = nextDigits.join("");
    onChange?.(next);
    if (focusIndex != null) {
      const target = Math.max(0, Math.min(length - 1, focusIndex));
      // Defer so focus lands after React commits the new values.
      requestAnimationFrame(() => inputsRef.current[target]?.focus());
    }
    // Deferred one tick so a consumer that reads the value back off its form
    // (rather than from the argument) sees the committed value, not the previous one.
    if (next.length === length && !next.includes("")) {
      setTimeout(() => onComplete?.(next), 0);
    }
  };

  const handleChange = (index) => (event) => {
    const typed = event.target.value.replace(/\D/g, "");
    if (!typed) return;

    const next = [...digits];
    // Typing several digits at once (autofill, fast entry) fills forward.
    for (let offset = 0; offset < typed.length && index + offset < length; offset += 1) {
      next[index + offset] = typed[offset];
    }
    emit(next, { focusIndex: Math.min(index + typed.length, length - 1) });
  };

  const handleKeyDown = (index) => (event) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = [...digits];
      if (next[index]) {
        next[index] = "";
        emit(next, { focusIndex: index });
      } else {
        next[Math.max(0, index - 1)] = "";
        emit(next, { focusIndex: index - 1 });
      }
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      const next = [...digits];
      next[index] = "";
      emit(next, { focusIndex: index });
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      inputsRef.current[index - 1]?.focus();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      inputsRef.current[index + 1]?.focus();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      inputsRef.current[0]?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      inputsRef.current[length - 1]?.focus();
    }
  };

  const handlePaste = (index) => (event) => {
    if (!allowPaste) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const pasted = (event.clipboardData?.getData("text") || "").replace(/\D/g, "");
    if (!pasted) return;
    const next = [...digits];
    for (let offset = 0; offset < pasted.length && index + offset < length; offset += 1) {
      next[index + offset] = pasted[offset];
    }
    emit(next, { focusIndex: Math.min(index + pasted.length, length - 1) });
  };

  const borderColor =
    status === "error" ? "#ff4d4f" : status === "warning" ? "#faad14" : "#d9d9d9";

  return (
    <div
      style={{
        display: "flex",
        gap: "clamp(6px, 2vw, 10px)",
        justifyContent: "center",
        width: "100%",
      }}
    >
      {digits.map((digit, index) => (
        <input
          // Index is the identity here: the boxes are positional and never reorder.
          key={index}
          ref={(node) => { inputsRef.current[index] = node; }}
          value={digit}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onPaste={handlePaste(index)}
          onFocus={(event) => event.target.select()}
          disabled={disabled}
          // `inputMode` brings up the numeric keypad on mobile; `type=password`
          // would force the browser's dot glyph and offer to save the value, so
          // masking is done with -webkit-text-security instead.
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={`Digit ${index + 1} of ${length}`}
          maxLength={1}
          style={{
            // Fluid so six boxes always fit a narrow phone without scrolling.
            width: "clamp(38px, 13vw, 52px)",
            height: "clamp(46px, 15vw, 58px)",
            textAlign: "center",
            fontSize: "clamp(18px, 5vw, 22px)",
            fontWeight: 600,
            borderRadius: 10,
            border: `1px solid ${digit ? "#1677ff" : borderColor}`,
            outline: "none",
            background: disabled ? "rgba(0,0,0,0.04)" : "transparent",
            color: "inherit",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            WebkitTextSecurity: masked ? "disc" : "none",
            textSecurity: masked ? "disc" : "none",
            caretColor: "#1677ff",
          }}
          onBlurCapture={(event) => { event.currentTarget.style.boxShadow = "none"; }}
          onFocusCapture={(event) => { event.currentTarget.style.boxShadow = "0 0 0 3px rgba(22,119,255,0.15)"; }}
        />
      ))}
    </div>
  );
}
