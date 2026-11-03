/** @jsxImportSource @scouterna/scoutin-print-templates */
// A neutral starting point for badge templates: a name that shrinks to fit,
// a white-on-black strip and a clamped group name. Copy it, rename it and
// change it. See docs/printing-templates.md.
import { FitText, type Label } from "@scouterna/scoutin-print-templates";
import { type } from "arktype";

// Used to validate values when a job is created, and to preview.
export const values = type({
  firstName: "string > 0",
  "lastName?": "string",
  "group?": "string",
});

export default function exampleNameTag(v: typeof values.infer, label: Label) {
  const pad = label.mm(4);
  const inner = label.width - pad * 2;
  const stripHeight = label.mm(10);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: label.width,
        height: label.height,
        backgroundColor: "white",
        color: "black",
      }}
    >
      {/* Reverse text: keep it to 28 px or more, regular or bold. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: label.width,
          height: stripHeight,
          backgroundColor: "black",
          color: "white",
        }}
      >
        <FitText
          width={inner}
          max={label.pt(18)}
          min={Math.max(28, label.pt(10))}
          fontWeight={700}
        >
          HELLO MY NAME IS
        </FitText>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: pad,
        }}
      >
        <FitText
          width={inner}
          max={label.pt(48)}
          min={label.pt(20)}
          fontWeight={700}
        >
          {v.firstName}
        </FitText>
        {v.lastName ? (
          <FitText width={inner} max={label.pt(24)} min={label.pt(12)}>
            {v.lastName}
          </FitText>
        ) : null}
        {v.group ? (
          <FitText
            width={inner}
            max={label.pt(18)}
            min={label.pt(12)}
            lineClamp={2}
          >
            {v.group}
          </FitText>
        ) : null}
      </div>
    </div>
  );
}
