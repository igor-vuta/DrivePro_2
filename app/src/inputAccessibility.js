// Keep caller-supplied IDs and names. Only labelled inputs need a generated
// web ID; unlabelled fields keep their placeholder-based behavior.
export function inputAccessibility(label, props, generatedId, native) {
  if (!label) return { labelFor: undefined, inputProps: props };
  if (native) {
    const named = props.accessibilityLabel != null || props.accessibilityLabelledBy != null ||
      props['aria-label'] != null || props['aria-labelledby'] != null;
    return {
      labelFor: undefined,
      inputProps: named || typeof label !== 'string' ? props : { ...props, accessibilityLabel: label },
    };
  }
  const labelFor = props.id != null ? props.id : props.nativeID != null ? props.nativeID : generatedId;
  return {
    labelFor,
    inputProps: props.id != null || props.nativeID != null ? props : { ...props, id: generatedId },
  };
}

// Raw HTML treats numeric line-height as a multiplier; React Native treats it
// as pixels. Keep the shared label's typography when rendering a web <label>.
export function webInputLabelStyle(style) {
  return { ...style, lineHeight: `${style.lineHeight}px`, display: 'block' };
}
