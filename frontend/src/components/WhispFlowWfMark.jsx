export function WhispFlowWfMark({ className, height = 36 }) {
  return (
    <span
      dir="ltr"
      style={{ display: 'inline-flex', flexShrink: 0, direction: 'ltr' }}
    >
      <img
        src="/whispflow-wf-mark.svg"
        alt="WhispFlow"
        width={Math.round(height * 2.25)}
        height={height}
        className={className}
        style={{ objectFit: 'contain', maxWidth: 'min(104px, 28vw)' }}
        decoding="async"
        draggable={false}
      />
    </span>
  );
}
